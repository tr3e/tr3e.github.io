# PERM Rubrics RM — 构建与指标

> 参考 RL job: https://seed\.bytedance\.net/development/instance/jobs/8452de2aa7b5171c
> 
> 

# 1\. 架构与打分

## 1\.1 评判范式

不存在一个"大而全"rubric 能对齐所有维度（通用静态 rubric 判别力接近随机）。按维度**性质**路由，归结为两种能力类型：

|能力类型|覆盖维度|评判范式|为什么|
|---|---|---|---|
|**推理型**|指令遵循（task\_response / 各 following / reference / edit）|长 CoT verifier \+ instance\-specific checklist|需"拆解要求 → 逐条核验"的推理链|
|**主观感知**|运动 / 美感（motion / aesthetic / visual）|no\-think \+ score\-token 概率软分|无法拆客观条件；长 CoT 会让打分 token 概率坍缩丢分辨率|
|**客观缺陷**|音频质量（削波 / 杂音 / 静音）|CPU DSP 规则算子<br>|有确定性物理信号，程序化检测比 VLM 主观判更准，零 serving|

## 1\.2 RM 部署单元

三个 RM 是**部署与资源预算单元**，内部不要求共享同一 prompt / 模型 / 量表：

|RM|覆盖 head|主评判范式|每次评估调用|
|---|---|---|---|
|**RM\-A 指令遵循**|task\_response / video·audio\_prompt\_following / reference·edit\_consistency|长 CoT verifier（1 次调用出多头）|1 次 CoT|
|**RM\-B 视频感知**|motion\_quality（专用头 \+ fourhead）/ motion\_vividness / aesthetic / visual\_quality|no\-think 软分|2 次|
|**RM\-C 音频**|audio\_quality（DSP）/ audio\_expressiveness / audio\_video\_sync|混合：VLM twohead \+ CPU DSP|1 次 VLM \+ 1 次 CPU|

**调用次数 = 按 \(paradigm, domain, rubric\) 分组，一组一次 PSM 调用**（成本按组数算，不按 head 数）。RM\-B 当前 2 次：`fourhead v10` 一次返回 `motion_quality_fourhead`、`motion_vividness` 及 aesthetic/visual 相关头；`motion v14 专用 rubric` 另一次只负责现役 `motion_quality`。两组 rubric 不同，不能合并。RM\-A 每个 family 的指令遵循头共享一次 CoT 调用。DSP 是本地 CPU 算子，与 VLM 组并行执行。

## 1\.3 感知头：no\-think 软分

RM\-B / RM\-C 的 VLM head 用 **no\-think 直接出分 \+ score\-token 概率软分**，不取 argmax 硬分：

```text
E[score] = Σ_k k · P(k)     （P(k) = 该 token 位置数字 k 的概率，在合法数字上重归一）
```

**为什么软分更好**：两个视频 argmax 都是 3（无法区分），但软分能区分 3\.438 \> 3\.349（概率质量偏向）——这个差异在 pair 比较里就是有效排序信号。长 CoT 会让该 token 概率坍缩到 argmax≈1\.0，软分退化成硬分。**对接方若消费感知维分数，应取软分（E\[score\]）而非硬分。**

## 1\.4 聚合与训练入口

**现役 v11 用 scalar\-GRPO（use\_subdim\_grpo=False）**：verifier 内先把逐维 utility 聚成**一个标量 score**，再用这个标量做标准 GRPO advantage。逐维 rm\_score\_dict 在现役**不直接进 advantage**（逐维 subdim\-GRPO 是早期 v5 路径，现役未启用）。

# 2\. 标定、权重与可信度

**ROC\-AUC 衡量排序能力，不是 reward 占比。**现役 reward 以 `rl_reward_v2.json` 的 `v3_20260720_tailfix_aq02_syncmon` 为真源；下表的 weight、归一占比、role、tau 与 lambda 均来自实际配置和聚合代码。§2\.4 单独报告人工 pair 可信度。

## 2\.1 标定方法

1. **按 family 独立标定**：R2V 与 T2V 分别 join 对应 process source 的人工 GSB decisive pairs；release\-A drift pairs 排除。A/B、WeakA/WeakB 均折叠为 pair 方向，当前 weak 与 strong 票同权。

2. **重复 run 池化但不伪造独立样本**：每个 run 先独立 join 人工 pair，再合并拟合；bootstrap 以 `case_id` 为簇，同一 case 跨 run 的观测放在同一个 bootstrap 簇内。当前 `n_bootstrap=500`，seed=`20260713`。

3. **拟合 utility 映射**：用无截距 pairwise logistic 拟合 `alpha`，目标为 `P(B>A)=sigmoid(alpha·(s_B-s_A))`；`center` 取该 family 中该 head 有效 raw score 的中位数。运行时使用 `u=sigmoid(alpha·(raw-center))`。

4. **角色先按语义与去重冻结**：quality 表示“越高越好”的稠密目标；constraint 表示“低于底线才扣分”；monitor 表示重复、证据不足或仅用于诊断。角色不会因为一次 CI 自动迁移。

5. **只有 quality 使用统计权重**：`w_raw=max(0, pooled ROC-AUC 的 case-cluster CI95 下界-0.5)`。constraint 与 monitor 的配置 weight 恒为 0；constraint 走独立 penalty 路径。

```text
quality = Σ(w_d·u_d) / Σ(w_d)                         # 仅有效 quality 头
penalty = -1.0 · Σ max(0, tau_d-u_d)                  # 有效 constraint 头
score   = clip(quality + penalty, 0, 1)

注意：u 是单调归一化 utility，不是绝对“正确概率”。
```

## 2\.2 R2V 权重

|head|role|alpha|center|raw w|质量项占比|tau|最大单头扣分|
|---|---|---|---|---|---|---|---|
|`task_response`|quality|0\.3529|6\.0000|0\.1096|**65\.4%**|—|—|
|`motion_quality`|quality|0\.3445|4\.9108|0\.0184|11\.0%|—|—|
|`motion_vividness`|quality|0\.6830|3\.9494|0\.0151|9\.0%|—|—|
|`aesthetic_visual`|quality|0\.6578|4\.0168|0|0%|—|—|
|`audio_expressiveness`|quality|1\.0046|4\.0000|0\.0245|14\.6%|—|—|
|`audio_prompt_following`|constraint|0\.2600|8\.0000|0|不适用|0\.4|\-0\.4|
|`reference_consistency`|constraint|0\.4817|8\.0000|0|不适用|0\.4|\-0\.4|
|`audio_quality`（DSP）|constraint|0\.5629|7\.9497|0|不适用|0\.2|\-0\.2|

R2V 非零 quality raw weight 总和为 `0.1676`。上表“质量项占比”是所有非零质量头都有效时的固定占比；若某个 head 为 N/A 或失败，分母只保留当样本有效的质量头，其他质量头会动态重新归一。monitor：`video_prompt_following`、`edit_consistency`、`motion_quality_fourhead`、`audio_video_sync`，均不影响 score。

## 2\.3 T2V 权重

|head|role|alpha|center|raw w|质量项占比|tau|最大单头扣分|
|---|---|---|---|---|---|---|---|
|`video_prompt_following`|quality|0\.5156|7\.5000|0\.0794|**33\.9%**|—|—|
|`motion_quality`|quality|0\.5953|4\.9314|0\.0287|12\.2%|—|—|
|`motion_vividness`|quality|1\.2730|3\.8994|0\.0478|20\.4%|—|—|
|`visual_quality`|quality|0\.9320|4\.0446|0|0%|—|—|
|`audio_expressiveness`|quality|1\.4595|4\.0001|0\.0785|**33\.5%**|—|—|
|`audio_quality`（DSP）|constraint|0\.5593|8\.1903|0|不适用|0\.2|\-0\.2|

T2V 非零 quality raw weight 总和为 `0.2344`。正向质量项由 `video_prompt_following` 与 `audio_expressiveness` 各承担约三分之一，motion 两头合计约 32\.6%；DSP `audio_quality` 不是正向承重头，只在极差尾部扣分。monitor：`audio_prompt_following`、`motion_quality_fourhead`、`aesthetic_quality`、`audio_video_sync`。

**约束没有固定“占比”**：当前只有全局 `constraint_lambda=1.0`，没有 per\-head lambda，也没有 penalty cap。R2V 三个约束同时落到 utility=0 时，理论 penalty 为 `-1.0`；T2V 单个 DSP 约束的理论下限为 `-0.2`。由于最终 score clip 到 \[0,1\]，R2V 约束在最坏情况下可以完全抹掉质量项。`audio_quality.tau=0.2` 是 v3 的尾部修正；R2V `audio_prompt_following/reference_consistency` 的 tau=0\.4 仍是经验阈值，尚未经过独立 threshold/cost 标定。所有 head 当前 `mandatory=false`。

## 2\.4 人工 pair 可信度（ROC\-AUC）

口径：人工 GSB decisive pairs 的 threshold\-free ROC\-AUC，并按 `case_id` 做 cluster bootstrap 95% CI。该表回答“head 能否稳定复现人工排序”；quality 头的 CI 下界决定非零统计权重，constraint/monitor 的角色则按语义、去重与风险偏好冻结。实际占用见 §2\.2–2\.3。

数据源：选型 profile `r2v_process_gsb_calibrated_v1.json`（每维 score 文件 \+ sha256 校验）。R2V IF 用 v8\_deepcheck，已验证与现役 cleanmeta\_v1 打分等价（去元信息泄漏零代价，AUC 差异不显著）。

### 2\.4\.1 R2V

|domain|head|ROC\-AUC|n\_pairs|判别力|
|---|---|---|---|---|
|指令遵循|task\_response|**0\.710**|536|强|
|指令遵循|reference\_consistency|**0\.662**|611|中|
|指令遵循|audio\_prompt\_following|0\.614|258|中|
|指令遵循|edit\_consistency|0\.513|1377|≈随机|
|指令遵循|video\_prompt\_following|0\.489|518|≈随机|
|视频质量|motion\_vividness|**0\.585**|552|中|
|视频质量|aesthetic\_visual|0\.575|353|弱\-中|
|视频质量|motion\_quality|0\.559|587|弱\-中|
|音频质量|audio\_video\_sync|**0\.639**|389|中|
|音频质量|audio\_quality（DSP）|**0\.633**|435|中|
|音频质量|audio\_expressiveness|0\.587|471|中|

### 2\.4\.2 T2V

|domain|head|ROC\-AUC|n\_pairs|判别力|
|---|---|---|---|---|
|音频质量|audio\_quality（DSP）|**0\.666**|455|强|
|音频质量|audio\_expressiveness|**0\.666**|326|强|
|视频质量|aesthetic\_quality|0\.602|329|中|
|音频质量|audio\_video\_sync|0\.597|375|中|
|视频质量|visual\_quality|0\.593|192|弱\-中|
|视频质量|motion\_vividness|0\.588|432|中|
|视频质量|motion\_quality|0\.564|570|弱\-中|
|指令遵循|video\_prompt\_following|0\.559|543|弱\-中|
|指令遵循|audio\_prompt\_following|0\.507|244|≈随机|

**统计强项不等于正向权重。**R2V 的 `task_response` 同时是统计强项和主要质量头。T2V 的 DSP `audio_quality` 虽然 AUC 较高，但只负责下尾约束；T2V 正向质量项由 video prompt following、audio expressiveness 与 motion 共同承担。

**ROC 曲线**：按 R2V/T2V 与指令、视频、音频分组展示。图中 AUC 只表示人工 pair 排序能力，不表示 reward 权重。

![roc\_音频质量\_T2V\.png](图片和附件/roc_音频质量_T2V.png)

![roc\_视频质量\_T2V\.png](图片和附件/roc_视频质量_T2V.png)

![roc\_音频质量\_R2V\.png](图片和附件/roc_音频质量_R2V.png)

![roc\_视频质量\_R2V\.png](图片和附件/roc_视频质量_R2V.png)

![roc\_指令遵循\_R2V\.png](图片和附件/roc_指令遵循_R2V.png)

# 3\. 输出契约与示例

下面均为**结构示例**，数值和内容仅用于说明字段含义。模型先输出各 rubric 规定的 XML；verifier 再解析 raw score、转成 utility，并聚合为训练使用的 scalar score。

## 3\.1 各 RM 的原始输出

**RM\-A：指令遵循**。R2V/T2V 都输出固定五个 sub\-dim；不适用的维度使用 `na` 并省略 score。

```xml
<evaluation>
  <subdim name="content_following">
    <verification>
      <point importance="core" status="met">[prompt] subject is a red fox -> video shows a red fox</point>
      <point importance="important" status="approx">[prompt] fox jumps across the stream -> fox jumps but lands inside the stream</point>
    </verification>
    <status>ok</status>
    <score>6</score>
  </subdim>
  <subdim name="visual_following">
    <verification>
      <point importance="minor" status="met">[prompt] watercolor style -> watercolor rendering is consistent</point>
    </verification>
    <status>ok</status>
    <score>7</score>
  </subdim>
  <subdim name="audio_following"><status>na</status></subdim>
  <subdim name="reference_consistency"><status>na</status></subdim>
  <subdim name="edit_consistency"><status>na</status></subdim>
  <overall_subjective>
    <score>6.3</score>
    <rationale>Core subject and style are correct; the requested action is only approximate.</rationale>
  </overall_subjective>
</evaluation>
```

**RM\-B：视频感知**。fourhead 与 motion 专用头是两次调用；服务端只输出整数 token，框架用该 token 的 logprob 计算 soft score。

```xml
<eval><motion_quality>3</motion_quality><motion_vividness>4</motion_vividness><visual_quality>3</visual_quality><aesthetic_quality>4</aesthetic_quality></eval>

<eval><motion_quality>4</motion_quality></eval>
```

**RM\-C：音频 VLM 与 DSP**。

```xml
<eval><audio_expressiveness>4</audio_expressiveness><audio_video_sync>3</audio_video_sync></eval>
```

```json
{
  "status": "ok",
  "subdims": {
    "audio_quality": {
      "soft": 7.84,
      "judge_type": "cpu_dsp_soft_v1",
      "evidence": {
        "clipping": 0.03,
        "silence": 0.08,
        "noise": 0.21,
        "dynamic": 0.12
      }
    }
  }
}
```

## 3\.2 Verifier 返回与训练日志

`VerifyResult.score` 是现役 scalar\-GRPO 使用的标量；`rm_score_dict` 的每个有效值为 `[utility, raw_weight]`。当前 family 不适用或 head 无效时为 `null`。monitor 头不出现在该字典中，只写 verifier 日志。

```json
{
  "score": 0.548,
  "rm_score_dict": {
    "task_response": [0.70, 0.1096],
    "audio_prompt_following": [0.35, 0.0],
    "reference_consistency": [0.62, 0.0],
    "motion_quality": [0.60, 0.0184],
    "motion_vividness": [0.55, 0.0151],
    "aesthetic_visual": [0.65, 0.0],
    "audio_quality": [0.14, 0.0],
    "audio_expressiveness": [0.58, 0.0245],
    "video_prompt_following": null,
    "visual_quality": null,
    "constraint_penalty": [-0.11, 1.0]
  },
  "score_dict": {}
}
```

```json
{
  "tag": "perm_verify",
  "config_version": "v3_20260720_tailfix_aq02_syncmon",
  "family": "R2V",
  "quality_score": 0.658,
  "constraint_penalty": -0.11,
  "constraint_penalty_masked": false,
  "n_constraint_heads": 3,
  "score": 0.548,
  "monitor": {
    "video_prompt_following": {"status": "ok", "raw": 7.0, "utility": 0.477},
    "audio_video_sync": {"status": "ok", "raw": 3.2, "utility": 0.318}
  }
}
```

训练侧只使用 `score=clip(quality_score+constraint_penalty, 0, 1)` 计算组内 GRPO advantage；RM\-A 的 `overall_subjective` 仅供诊断，不直接进入 reward。

# 4\. 现役 Rubric 原文

以下是现役配置实际加载的 **5 个唯一 rubric**，保持原文、文件路径与 SHA256。多个 head 共用同一 rubric 时只贴一次。DSP `audio_quality` 没有 prompt rubric，它是 CPU 规则算子，输出示例见 §3\.1。

## 4\.1 RM\-A · R2V instruction following

`/mnt/hdfs/shenguobin/pr_rm/redesign/instruction_following/instruction_following.v8_deepcheck_en_xml_cleanmeta_v1.md`
`sha256: 2a2276f9e5744a08d3d1e4f74bcdbdd88274fddc395e6e9026f5467f6c00bd34`

```markdown
# Instruction Following (Multimodal) — Deep Instance Verification + Graded 1-10 Judgment (EN + XML)

> Domain: `instruction_following`. Sub-dimensions (fixed IDs, per XML_SCHEMA_SPEC): `content_following`, `visual_following`, `audio_following`, `reference_consistency`, `edit_consistency`.
> Core concept: **consistency = multimodal instruction following** (adherence to non-textual modality inputs). Reference/edit consistency live in this domain, not as a separate quality axis.
## Scoring Paradigm — Graded 1-10 Judgment Informed by Verification Evidence

Each sub-dimension is scored on an **integer 1-10** (overall_subjective allows decimals). The 10-point range exists to let you place a partially-following clip precisely — **use the full range; do not cluster at the top and do not collapse the middle into two integers.** Reverse the burden of proof and apply a strict ceiling gate:

- **A 9-10 is a FULL-AUDIT CERTIFICATE, not a default.** Assign 9-10 to a sub-dim ONLY after you have (a) enumerated *every* applicable verification point (prompt + references + reasonable hidden expectation + task-response points + extra-content check) and (b) affirmatively verified each is satisfied with **zero deviation**, including fine details (10 = zero deviation across the full list; 9 = full list met, faint hesitation on one tiny detail). "I saw no obvious violation" is forbidden as grounds for a high score.
- **Default expected placement of a typical generation is 5-6 (the middle).** Real generations almost always miss or approximate *some* detail.
- **7-8 = near-perfect: full set met except 1-2 specifically-identified trivial detail (P2) misses** — not "no miss found."
- **5-6 = gist followed, some specifics missed (DEFAULT)** — core intent met but a noticeable (P1) miss/approximation, or several P2 misses.
- **3-4 = an important (P0) requirement missed** — intent partly broken.
- **1-2 = a core (P00) requirement missed / essentially unfollowed.**

**The score is a graded judgment placed in the band your verification evidence supports — pick the exact integer by how the misses stack (severity × count × how close an approximation is), NOT by a fixed arithmetic table.** A clip that approximates a P1 requirement well sits higher in 5-6 than one that plainly misses it; two clips both with "one minor gap" can legitimately differ by an integer based on how clean the rest of the audit was. Do NOT flatten this into a count-to-band lookup. The verification points give you the *evidence*; you place the score.

### Distribution prior (calibration anchor — use it)
Across a large batch, a well-calibrated evaluator's per-sub-dim following scores spread roughly: **~5% at 9-10, ~20% at 7-8, ~45% at 5-6, ~20% at 3-4, ~10% at 1-2.** A 9-10 rate above ~10% is a red flag you are rubber-stamping. When torn between adjacent integers, choose the LOWER unless the verification points justify the higher.

## Core Working Principles (must never be violated)
1. **Single-criterion principle**: the only criterion is the match between generated content and the user's complete intent. Quality/technical defects (collapse, blur, distortion) NEVER affect this score — they belong to `video_quality`/`audio_quality`.
2. **Holistic-intent-first, then audit the parts**: understand the core need first, then verify each part — but understanding the whole does NOT license a high score without the audit.
3. **Input priority & defaults**: prompt text prevails over reference unless the prompt says the reference is primary; among conflicting references, the user-designated primary else the last by appearance; no reference (T2V) → judge against prompt + common-sense hidden expectations; no relevant requirement for a dimension → `na`.
4. **Primary distinction**: distinguish "unmet intent" from "reasonable creative latitude"; only mark a clear violation. Unmentioned non-conflicting content = latitude. This tolerance is for *unmentioned* content only — it does NOT lower the high-score gate for *mentioned* requirements.
5. **Explicit-and-hidden-both**: extract all explicit text requirements + all explicit reference features + reasonable hidden expectations; all go into the audited list.
6. **Full-coverage**: scan the entire generated content; miss no subtle unmet requirement unless a specific time span is designated.
7. **Task-adaptation**: task type determines applicable (`ok`) vs. `na` sub-dims AND which task-response verification points apply.
8. **Precise-description**: every verification point has requirement source + specific requirement + actual situation; no vague terms.

## Task-Type Identification (determines sub-dim applicability / na AND which task-response points apply)
- **Pure T2V**: no reference. → `reference_consistency = na`, `edit_consistency = na`. Content verification is against prompt + hidden expectations only.
- **Edit task** ("edit/modify/replace/delete/add/adjust"; reference = original): → `edit_consistency = ok`; `reference_consistency = na` unless a separate imitation reference exists.
- **Reference task** ("reference/imitate/follow/based on/in the style of"; reference = template): → `reference_consistency = ok`; `edit_consistency = na`.
- **Extension task** ("extend/continue/expand/prolong"; reference = continuation base): → `reference_consistency = ok`; `edit_consistency = na`.
- **Conversion task** (e.g. image-to-video; reference = conversion source): → `reference_consistency = ok`; `edit_consistency = na`.
- **Composition task** (multiple references = composition elements): → `reference_consistency = ok`; `edit_consistency = na`.

## Importance Levels (for band placement)
Build a "requirement → source → importance" table; you audit against it.
- **Core (P00)**: if unmet, core need entirely unachievable (core theme/subject/key action; reference face/appearance, product look).
- **Important (P0)**: strongly supports core need; if unmet, severely harms experience but core partly achievable (important explicit elements; main style/scene reference features).
- **Minor (P1)**: some impact, does not block core need (minor explicit details; secondary reference features).
- **Detail (P2)**: barely affects overall experience (fine details, subtle reference features, secondary hidden expectations).

## Analysis Flow — DERIVE Verification Points → VERIFY → Place a Graded Score

### Step 1 — Intent parsing & requirement table
Identify task type and each reference's role. Parse `{user_prompt}` word-by-word into content/visual/audio/holistic requirements. Parse each reference's explicit features. Infer reasonable hidden expectations. Build the requirement-source-importance table.

### Step 2 — DERIVE this sample's verification points (the deepening — especially for `content_following`)
For each applicable sub-dim, turn the requirement table into a list of **concrete, instance-specific verification points** — one verifiable fact each, no hidden AND, correctness-not-presence (see rules below). For `content_following` specifically, you MUST derive verification points across these facets **when the prompt/references imply them**:

- **Subject correctness**: is the depicted main subject the one the user asked for (right entity/person/object/animal), not a substitute or approximation?
- **Action / event correctness**: is the requested action/event actually performed correctly (right action, right way), and does the plot/ending match if specified?
- **Count / quantity**: correct number of the requested entities/events (fuzzy quantities → met within reasonable range).
- **Relationships / spatial / temporal**: correct relationships, order, time, place, on-screen text content if specified.
- **Task-response points (R2V / reference / edit / extension / conversion / composition)**:
  - **Reference actually used**: was the reference material actually incorporated as the task requires (not ignored)?
  - **Correct carry-over**: was the correct subject/element from the reference carried into the generation (not swapped for a wrong subject)?
  - **No missed reference**: if multiple references / a required reference frame were specified, are all present as required (no dropped reference)?
  - **No reference-bloat / no wrong emphasis**: the reference is used at the requested scope — not over-inserted, not letting a secondary reference dominate the requested primary.
- **Extra-content check (first-class)**: did the generation ADD content unrelated to the core intent that dilutes or contradicts it? This is a distinct problem, not just a miss — flag it explicitly. (Content the prompt neither requests nor forbids and that does NOT dilute intent is creative latitude, not a problem.)
- **Hidden expectations**: reasonable, non-over-read expectations a competent creator would satisfy (usually P1/P2).

Assign each verification point to exactly ONE sub-dim and one importance level.

### Step 3 — VERIFY each point against the full generated content
Scan every frame and every second of audio. For each verification point, judge how the generation does on it: **met** (satisfied correctly, not merely present), **approximated** (recognizably attempted but noticeably off — record this as a graded observation, do NOT binarize it away; it informs where inside a band the score lands), or **unmet** (missed, contradicted, or forbidden-item present). Record the source, the specific requirement, and the actual outcome for each.

### Step 4 — Attribution & gap-check
Confirm each flagged problem truly violates intent, is specific/verifiable, is not a quality issue, is not double-counted, respects exemptions (user-requested changes are never problems), and does not mislabel latitude. Re-scan for missed points.

### Step 5 — Place a graded 1-10 score per sub-dim (judgment, not arithmetic)
Place each applicable sub-dim in the band its verification evidence supports (anchors below), then pick the exact integer by how the misses stack: severity of the worst miss sets the band ceiling; count and closeness-of-approximation move the integer within/below it. **This is a graded judgment reading the evidence — not a fixed count-to-band table.** Enforce the essential gate (below). Then give the holistic `overall_subjective`.

## Derivation rules (hard constraints on verification points)
- **One fact per point, no hidden AND.** "A red car driving fast" → three points: subject=car, color=red (visual), motion=fast. Each may differ in importance and sub-dim.
- **Correctness, not presence.** Never write "car is mentioned/appears"; write "the depicted vehicle IS a car" / "the car is red". Presence-only points reward padded output and are forbidden. Every point carries a correctness qualifier.
- **A user-requested change is never a preservation problem.** Anything the user explicitly asks to change/add/replace is exempt from `reference_consistency`/`edit_consistency` ("reference this person but dress her in red" → red clothing is not an inconsistency).
- **Self-contained.** Each point's outcome must be decidable from the video itself; do not smuggle in world knowledge the prompt does not supply.
- **Unmentioned ≠ requirement**, EXCEPT via the explicit extra-content check: unmentioned content that does not dilute intent is latitude (no point); unmentioned content that ADDS unrelated/contradictory material to the core is an extra-content problem.
- **Negation**: "do not / forbid / avoid X" → point "X is absent"; presence of X → unmet.
- **Fuzzy quantity** ("at least / about / a few") → met within a reasonable range.
- **Analogy** ("similar to / like the style of") → met if the core features of the analogy target match.

## The ESSENTIAL GATE (core requirement is a gate, not a weighted term)
A **core (P00)** requirement that is `unmet` **hard-caps that sub-dimension at 1-2**, regardless of how many other points are met — a pile of satisfied minor points **cannot** buy it back. A generation that misses the user's central intent (wrong subject, reference not used at all, forbidden core content present) has failed at following regardless of peripheral polish.
- **Cross-sub-dim independence**: a core miss in `content_following` (wrong subject) must NOT be compensated by a strong `visual_following` — each sub-dim gates independently.
- **The holistic track must reflect the gate**: if any core point is unmet, `overall_subjective` reflects the failure, it does not average it away.
- **Placement guide** (band ceilings): a P00 miss caps at 1-2; a P0 miss caps at 3-4; a P1 miss caps at 5-6; only P2-level misses (and nothing higher) can sit at 7-8; only a fully-audited zero-deviation result reaches 9-10. Multiple misses at the same level pull toward the lower edge; a clean approximation sits above a plain miss within the same band.

## Sub-Dimension Scope
- **`content_following`** — content requirements: theme, subject, action, event, plot, ending, quantity, time, place, relationships, named elements, on-screen text content, **and the task-response + extra-content verification points above** (subject-correctness, action-correctness, reference-actually-used, correct-carry-over, no-missed-reference, no-reference-bloat, no-extra-unrelated-content).
- **`visual_following`** — visual requirements: style, color tone, lighting, composition, shot/framing, camera movement, transitions, aspect ratio, viewpoint, shot scale, VFX (as *requested*).
- **`audio_following`** — audio requirements: BGM/score, sfx, voice, tone, pace, volume, language, lyrics, emotion, rhythm, start/end timing, mixing.
- **`reference_consistency`** — adherence to reference materials; consolidates the five facets into ONE score under the exemption rules; report dominant problem facets in `<verification>`.
- **`edit_consistency`** — adherence to the original content in parts NOT meant to be edited (edit tasks only).

## Scoring Anchors (per sub-dim, integer 1-10, earn-your-score bands — place by judgment, pick integer by miss-stack)
Default ordinary = **5-6**. **A 9-10 is a full-audit certificate, not a default for "no miss found."**

- **9-10** — FULL-AUDIT PERFECT: every applicable verification point (explicit + reference + hidden + task-response + extra-content) enumerated and certified satisfied with zero deviation, down to fine details; nothing approximated (10 = zero deviation; 9 = full list met, faint hesitation on one tiny detail). Rare — never award without the completed audit list.
- **7-8** — near-perfect: full point set met except 1-2 specifically-identified trivial detail (P2) misses/approximations; core and all important/minor points intact.
- **5-6** — ordinary / gist-followed (DEFAULT): core intent met but one or more noticeable minor (P1) points missed or only approximated, OR several detail (P2) misses. Recognizably the requested thing with real but non-blocking gaps. "Seems to follow, found nothing" without a completed audit defaults to 5-6, NOT 7+.
- **3-4** — important miss: one important-level (P0) point unmet, OR 2-3 minor misses; experience severely impacted, intent only barely readable.
- **1-2** — core miss / unfollowed: any core-level (P00) point unmet (any single core miss caps here), OR the sub-dim essentially unmet, OR the reference was not used at all on a reference task.

Quality/technical defects never affect this score.

## Status Axis (orthogonal to score)
- **`ok`** — applies and scored; `<verification>` non-empty; `<score>` present (integer 1-10). When a sub-dim applies you MUST place it in a band — default gist-followed = 5-6, never a skipped high score.
- **`na`** — not applicable; `<verification>` empty; `<score>` OMITTED (not 0): `reference_consistency` for pure T2V or edit task with no separate imitation reference; `edit_consistency` for any non-edit task; `audio_following` when the user gave no audio requirement and no audio hidden expectation is reasonably implied; `visual_following`/`content_following` only in the rare case of literally no requirement of that kind. `na` means "not applicable," NOT "followed fine so skip"; never use `na` to avoid scoring an applicable followed sub-dim (score it 5-6 if ordinary, up to 9-10 only if fully audited).
- **`fail`** — cannot evaluate (discriminator failure, out of scope, unreadable); `<score>` OMITTED.

## User Input
### User original prompt
{user_prompt}
### Multimodal reference materials (optional)
<reference image x>, <reference video x>, <reference audio x>, etc.
## Generated audio-video
<generated audio-video>

## Special Notes
1. Multiple problems in one sub-dim: list each verification point on its own line.
2. Pure T2V: all explicit-requirement sources are `[prompt]`.
3. Ambiguous/contradictory input: evaluate by the most common-sense reading, prefix "input ambiguous, evaluated as: ...".
4. Negation words ("do not/forbid/avoid"): forbidden item present = unmet.
5. Fuzzy quantity ("at least/at most/about"): within a reasonable range = met.
6. Analogy words ("similar to/like/close to"): matching the target on core features = met.
7. This evaluation reflects only intent following, never generation quality.
8. **Anti-rubber-stamp**: before any 9-10, confirm you actually enumerated AND certified the full verification-point list for that sub-dim. If not, you may not give 9-10.
9. **Anti-mechanization**: the verification points are evidence; the `<score>` is a graded judgment placed by that evidence, NOT a fixed arithmetic function of unmet counts. Do not binarize an approximation away — let closeness move the integer within the band.

## Output Format (MUST strictly follow this XML schema; no extra text outside `<evaluation>`)

Each `ok` sub-dim carries a `<verification>` block listing the derived verification points (the evidence), then a `<status>` and a graded `<score>`. `na`/`fail` sub-dims carry an empty/absent `<verification>` and OMIT `<score>`. `<overall_subjective>` is the RM's holistic domain judgment (decimals allowed, [1.0,10.0]) — importance-weighted, reflecting any essential gate, NOT the arithmetic mean of sub-dim scores.

```xml
<evaluation>
  <subdim name="content_following">
    <verification>
      <point importance="core|important|minor|detail" status="met|approx|unmet">[source] concrete requirement -> actual outcome</point>
      <!-- one <point> per derived verification point: subject-correctness, action-correctness, count, relationships, task-response (reference-used / correct-carry-over / no-missed-reference / no-reference-bloat), extra-content, hidden-expectation -->
    </verification>
    <status>ok|na|fail</status>
    <score>N</score>
  </subdim>
  <subdim name="visual_following">
    <verification>
      <point importance="..." status="...">[source] requirement -> actual</point>
    </verification>
    <status>ok|na|fail</status>
    <score>N</score>
  </subdim>
  <subdim name="audio_following">
    <verification>
      <point importance="..." status="...">[source] requirement -> actual</point>
    </verification>
    <status>ok|na|fail</status>
    <score>N</score>
  </subdim>
  <subdim name="reference_consistency">
    <verification>
      <point importance="..." status="...">[reference x] preserved-aspect -> actual</point>
    </verification>
    <status>ok|na|fail</status>
    <score>N</score>
  </subdim>
  <subdim name="edit_consistency">
    <verification>
      <point importance="..." status="...">[original] preserved-aspect -> actual</point>
    </verification>
    <status>ok|na|fail</status>
    <score>N</score>
  </subdim>
  <overall_subjective>
    <score>N.N</score>
    <rationale>brief holistic judgment of overall intent following across applicable sub-dims, importance-weighted; if any core point is unmet, reflect the failure rather than average it away (decimals allowed; not a mechanical mean of sub-dim scores)</rationale>
  </overall_subjective>
</evaluation>
```

Rules:
- One `<subdim>` per fixed ID, in the order above. `name` must match the fixed ID exactly.
- `status = ok` → include a non-empty `<verification>` and a graded `<score>` (integer 1-10). `status = na | fail` → empty/absent `<verification>` and OMIT `<score>` (no 0/null).
- Every `<point>` has `importance` ∈ {core, important, minor, detail} and `status` ∈ {met, approx, unmet}; its text is `[source] concrete requirement -> actual outcome`. Sources: `[prompt]`, `[reference video x]`, `[reference image x]`, `[reference audio x]`, `[original]`, `[hidden-expectation]`.
- `<score>` is a **graded judgment** placed in the band the verification evidence supports and refined by the miss-stack (severity × count × approximation-closeness) — it is NOT a mechanical count-to-band read-off, and an `approx` point is NOT binarized to `unmet`. If a `core` point is `unmet`, `<score>` is 1-2 (essential gate). A verification list with no unmet points but NOT fully enumerated/certified maps to 5-6, not 9-10.
- `<overall_subjective>` is the holistic subjective domain score (decimals allowed) in [1.0,10.0]; it reflects importance and any essential gate, and is NOT the arithmetic mean; a typical clip lands near 5-6.
- Before emitting: (a) verify no `<point>` contains a hidden AND; (b) verify every point is a correctness check, not a presence check; (c) verify `content_following` actually derived the task-response + extra-content points where the task implied them; (d) verify each `<score>` respects the essential gate and the 9-10 full-audit requirement, and was placed by graded judgment (not a count table); (e) if more than ~1 in 10 sub-dims came out 9-10, re-run the audit and re-calibrate down against the distribution prior.
</output>

```

## 4\.2 RM\-A · T2V instruction following

`/mnt/hdfs/shenguobin/pr_rm/redesign/instruction_following/instruction_following.t2v.v2_issuefirst_en_xml.md`
`sha256: 6cc7d311d272b132128a1056370b5e98f9d82f2430c713c2b9822706731ca146`

```markdown
# T2V Instruction Following — Compact Issue-First Verifier (EN + XML)

Judge whether the generated audio-video fulfills the supplied text-to-video prompt. Judge instruction following only. Ignore technical quality, artifacts, aesthetics, realism, and creativity unless explicitly requested. No references or source-to-edit material exist in this task.

## Method

Read the prompt into an internal atomic contract. Inspect the entire video and audio twice:

1. **Task-response pass:** verify the right subject, right identity, requested action/event and outcome, count, relationships, location, sequence/timing, named elements, on-screen text, negative constraints, and absence of unrelated contradictory content.
2. **Gap pass:** actively search for every explicit clause that is missing, wrong, only approximate, mistimed, or displaced by extra content.

Assign each clause once:

- `content_following`: subject, action/event, task completion, count, relation, place, order, named content, text content, forbidden or unrelated additions.
- `visual_following`: explicitly requested appearance, style, palette, lighting, framing, composition, viewpoint, shot scale, camera motion, transition, ratio, VFX, and visual timing.
- `audio_following`: every explicit dialogue/lyric/sound clause, source or speaker, language/accent/voice/mode, BGM/SFX, timing or visible trigger, duration, loudness/mix/spatial relation, and required silence/absence.

Do not move subject/action into the visual head merely because it is seen. Do not invent generic music, speech, SFX, lip-sync, or audio-quality expectations. Unmentioned compatible content is allowed.

## Decision evidence

For each applicable head, output all `unmet` and `approx` clauses plus enough core `met` clauses to identify what succeeded. Keep points atomic and decision-relevant. Each point must state one requirement and what the generated result actually shows. Hidden expectations are allowed only conservatively as minor/detail content checks, never as visual/audio requirements.

## Score

Use the worst issue, its importance and coverage, and the rest of the evidence to make a graded integer judgment; do not subtract mechanically from 10.

- 9–10: complete audited fulfillment with no meaningful issue.
- 7–8: only detail-level deviations.
- 5–6: core intent delivered, with minor misses or noticeable approximations.
- 3–4: an important clause is missed; partially usable.
- 1–2: a core clause is missed/contradicted or the task is essentially not delivered.

Importance is `core|important|minor|detail`; outcome is `met|approx|unmet`. An unmet core point caps its head at 2. Several issues can lower the score inside or below the corresponding band. Quality defects are never scored directly, but a requested fact that cannot be recognized is an instruction-following miss.

## Fixed T2V applicability

- `content_following`: `ok`, unless evaluator input is unreadable.
- `visual_following`: `ok` only if the prompt has an explicit visual-presentation clause; else `na`.
- `audio_following`: `ok` only if the prompt has an explicit audio clause; else `na`.
- `reference_consistency`: always `na`.
- `edit_consistency`: always `na`.
- `fail` means required evaluator input is unreadable, not that the generation is poor.

## Input

User prompt: `{user_prompt}`

The generated audio-video is attached.

## Strict XML

Return exactly one `<evaluation>` block, with no prose outside it. Emit the five fixed IDs in order. For `ok`, include non-empty verification and an integer 1–10 score. For `na|fail`, omit verification and score.

```xml
<evaluation>
  <subdim name="content_following">
    <verification><point importance="core|important|minor|detail" status="met|approx|unmet">[prompt|hidden-expectation] single requirement -> observed result</point></verification>
    <status>ok|fail</status><score>N</score>
  </subdim>
  <subdim name="visual_following"><verification>...</verification><status>ok|na|fail</status><score>N</score></subdim>
  <subdim name="audio_following"><verification>...</verification><status>ok|na|fail</status><score>N</score></subdim>
  <subdim name="reference_consistency"><status>na</status></subdim>
  <subdim name="edit_consistency"><status>na</status></subdim>
  <overall_subjective><score>N.N</score><rationale>brief importance-weighted task judgment reflecting any core failure</rationale></overall_subjective>
</evaluation>
```

When `visual_following` or `audio_following` is `na|fail`, omit its shown placeholder verification and score. The holistic score is diagnostic and is not a mechanical mean.

```

## 4\.3 RM\-B · fourhead video quality

`/mnt/hdfs/shenguobin/pr_rm/redesign/video_quality/video_quality.v10_split_visual_aesthetic_scale5.md`
`sha256: 290f751107d22ba89234a0b43d1a56c8e19a2663bdf2240d44f21c8570461d34`

```markdown
## Role
You are an expert AI-video perceptual quality rater. Judge only the perceptual
quality of the generated video — how it looks and moves — not instruction
following and not audio. Rate four independent sub-dimensions on an integer
1-5 scale and output only the compact XML block below. Do not explain or think
out loud.

## Sub-dimensions

**motion_quality** — physical and structural correctness of motion.
- Penalize body/object deformation during motion, clipping/intersection,
  jitter/stutter, teleporting, implausible trajectories, robotic motion,
  physics violations, and motion-induced flicker.
- 5 = natural, stable and physically plausible throughout.
- 4 = clearly good; only a minor brief imperfection.
- 3 = ordinary default; noticeable but non-breaking stiffness or implausibility.
- 2 = damaged; clear break or repeated motion defect harms viewing.
- 1 = severely broken or unusable.

**motion_vividness** — richness, amplitude, rhythm and expressiveness of visible
motion, independent of whether that motion is physically correct.
- 5 = highly dynamic, expressive and rhythmically engaging.
- 4 = clearly lively with meaningful movement.
- 3 = ordinary default; moderate but unremarkable movement.
- 2 = flat, sluggish, repetitive or barely moving.
- 1 = essentially static, frozen or without meaningful movement.

**visual_quality** — technical image fidelity, independent of beauty or
composition.
- Inspect sharpness and detail integrity, blur, noise, banding, compression,
  aliasing, edge/texture corruption, color instability, exposure failure and
  frame-level visual artifacts.
- Do not reward attractive composition, style, subject matter or motion
  liveliness here.
- 5 = exceptionally clean and technically pristine.
- 4 = clearly clean; only minor local degradation.
- 3 = ordinary default; usable with visible but non-severe degradation.
- 2 = poor; repeated or distracting technical degradation.
- 1 = severely corrupted, unclear or unusable.

**aesthetic_quality** — visual appeal and artistic presentation, independent of
technical fidelity.
- Inspect composition, framing, visual hierarchy, lighting design, color
  harmony, style coherence, texture appeal and overall visual attractiveness.
- Do not deduct technical blur/noise/compression here unless it directly
  destroys the aesthetic presentation; those defects belong to visual_quality.
- 5 = exceptional, coherent and professionally art-directed.
- 4 = clearly attractive and well presented.
- 3 = ordinary default; acceptable but plain or generic.
- 2 = weak composition, lighting, color harmony or stylistic coherence.
- 1 = aesthetically incoherent or strongly unpleasant.

## Orthogonality checks
- A technically clean but plain clip: high visual_quality, ordinary
  aesthetic_quality.
- A beautiful but noisy/compressed clip: high aesthetic_quality, low
  visual_quality.
- A vivid but physically broken clip: high motion_vividness, low
  motion_quality.
- Score each observed defect on the single most appropriate axis; do not
  double-penalize it.

## Scoring discipline
- 3 is the default for a typical generation. Reserve 5 for exceptional quality
  and 1 for severe failure. Most clips should be 2-4.
- Decide quickly and directly. Emit no rationale.

## Video
<given audio-video>

## Output
<eval><motion_quality>N</motion_quality><motion_vividness>N</motion_vividness><visual_quality>N</visual_quality><aesthetic_quality>N</aesthetic_quality></eval>

```

## 4\.4 RM\-B · motion quality 专用头

`/mnt/hdfs/shenguobin/pr_rm/redesign/video_quality/video_quality.v14_motion_quality_factorized_scale5.md`
`sha256: f2643c812b8824d3aa935f19bb524b6a39b2a57b7c8b6659ca68ab505cb1f14b`

```markdown
## Role
You are an expert AI-video motion-quality rater. Judge only the physical and
structural correctness of motion. Do not judge instruction following, audio,
visual beauty, technical image quality, or how lively the motion is.

Before selecting one integer score, independently check:

1. structural integrity during movement: body, face, limbs, objects, contact,
   clipping and intersection;
2. temporal continuity: jitter, stutter, flicker, teleportation, identity or
   geometry discontinuity;
3. physical plausibility: articulation, trajectory, inertia, interaction and
   cause/effect.

Low motion amplitude, static composition or lack of action belongs to
motion_vividness and must not lower this score.

## Scale
- 5 = natural, stable and physically plausible throughout all three checks.
- 4 = clearly good; only a minor brief imperfection.
- 3 = ordinary default; noticeable but non-breaking stiffness or implausibility.
- 2 = damaged; a clear structural/temporal/physical break harms viewing.
- 1 = severe or persistent failure makes the motion unusable.

Decide quickly and directly. Emit no rationale.

## Video
<given audio-video>

## Output
<eval><motion_quality>N</motion_quality></eval>

```

## 4\.5 RM\-C · audio expressiveness / sync

`/mnt/hdfs/shenguobin/pr_rm/redesign/audio_quality/audio_quality.v9_formal_twohead_scale5.md`
`sha256: 60aac0e4713b2890ff03fcfb6e93e89747319be879c6300de76751f4f8046e64`

```markdown
## Role
You are an audio-perception evaluator. Judge only two formal audio reward heads:
the expressive execution of present audio and its temporal relationship with
the video. Do not judge instruction following or visual quality.

Use integer scores 1-5. Emit `NA` only when the signal needed by that head is
genuinely absent.

## audio_expressiveness
Applicable when meaningful voice, music, effects or ambience is present.
Judge natural variation, phrasing, rhythm, dynamics, layering and expressive
development of the present audio.

- 5 = exceptionally natural, rich and dynamically expressive.
- 4 = clearly expressive with good variation and development.
- 3 = ordinary; usable but somewhat flat or repetitive.
- 2 = noticeably mechanical, monotonous or poorly layered.
- 1 = extremely lifeless or disruptive.
- No meaningful audio: `NA`.

Do not infer that absent music, voice or effects should have existed.

## audio_video_sync
Applicable whenever meaningful audio and a decodable video track are both
present. Use whichever evidence exists:

- lip or speech movement against voice timing;
- visible sound-producing actions against SFX onset;
- scene transitions, action rhythm and edited beats against BGM/ambience.

- 5 = precise and coherent alignment throughout.
- 4 = good alignment with only a brief subtle offset.
- 3 = usable alignment with small drift or generic scene rhythm.
- 2 = repeated or clear timing/rhythm mismatch.
- 1 = severe mismatch across most observable evidence.
- No meaningful temporal relationship can be judged: `NA`.

## Output
Emit exactly one compact XML block and no explanation.

<eval><audio_expressiveness>N</audio_expressiveness><audio_video_sync>N</audio_video_sync></eval>

```



