以下是为您整理的脱敏版技术面试介绍文档。本篇内容基于 [[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb) 进行了系统性的提炼，旨在帮助您在面试中以逻辑清晰、富有技术洞察的方式进行表达：

# PERM Rubrics RM — 构建与核心指标技术介绍

## 1. 架构与评估范式

在评估生成模型的各项能力时，不存在一个能够覆盖所有维度的“大而全”的静态标准（Rubric）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。为了保证评分的有效性和可区分度，我们的模型评估架构根据维度的**性质**，将评估任务解耦为三大类型，并分别对应不同的评判范式[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)：


| 能力类型     | 评估重点                   | 评判范式                              | 核心逻辑                                             |
| -------- | ---------------------- | --------------------------------- | ------------------------------------------------ |
| **推理型**  | 指令遵循（内容、视觉、音频、参考一致性等）  | 长思维链（CoT）验证 + 实例级检查清单             | 需要进行“拆解要求 → 逐条核验”的复杂推理过程，确保生成结果准确贴合用户意图。         |
| **主观感知** | 视觉呈现（运动质量、画面生动度、视觉美感等） | 无思考（No-think） + 概率软打分（Soft Score） | 避免长CoT导致的打分概率坍缩，通过软分（期望分数）保留分布差异，更好地捕捉主观感知的细微对比。 |
| **客观缺陷** | 音频质量（削波、杂音、静音等）        | 确定性规则算子（DSP）                      | 对于物理信号明确的缺陷，程序化检测比大模型主观判断更精确，且节省算力。              |




### 评估部署与资源分配

为了优化评估成本与资源利用，我们将评估系统划分为三个独立的部署单元（RM），并按组（Group）进行服务调用[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)：

- **RM-A（指令遵循）**：单次调用生成长CoT验证结果，覆盖多模态指令遵循与一致性校验等多个打分维度[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
- **RM-B（视觉感知）**：负责运动质量、画面生动度及美感等感知维度的评分，直接输出无思考软分[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
- **RM-C（音频质量）**：结合VLM多头评估（表现力、音画同步）和本地 CPU 规则算子，输出综合音频评分[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。

> **💡 面试洞察表达**：
> “在系统设计上，我们没有按传统的‘评估维度’来计费和调用模型，而是按评判范式和领域进行了分组（部署单元化），这大幅降低了推理成本。同时，针对主观感知类指标，我们引入了无思考软分机制（期望分数 `E[score] = Σ_k k · P(k)`）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。这有效解决了大模型打分容易向高分或特定整数趋同的问题，使得模型产出在成对比较（Pairwise）中具备了更细粒度的排序能力。”

---



## 2. 标定策略与可靠性验证

评估分数的可靠性直接影响强化学习（RL）阶段奖励模型的训练效果[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。系统通过以下策略确保评估体系的科学性：

### 标定与权重分配

1. **独立标定与聚合**：各生成通道（如文生视频、图生视频）独立标定，通过无截距配对逻辑回归拟合分数映射，消除不同场景下的基准分数偏移[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
2. **角色定义冻结**[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)：
  - **Quality（质量项）**：目标为“越高越好”，以加权平均的形式驱动模型正向优化。
  - **Constraint（约束项）**：目标为“触底扣分”，采用独立的惩罚路径，主要拦截严重缺陷。
  - **Monitor（监控项）**：仅用于日志诊断与记录，不参与最终打分。
3. **基于可信度的权重赋予**：仅当某个维度的打分能在人工配对排序判断（ROC-AUC）中展现出统计显著的置信度时，才基于 CI95 下界赋予其正向质量权重[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。



### 可信度分析（基于ROC-AUC）

我们通过 ROC-AUC 验证了自动化评估复现人工排序的能力[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)：

- **指令遵循**：核心维度展现出**强**的排序能力（ROC-AUC > 0.70）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
- **音频质量**：下尾约束项及音频表现力同样表现出**强**的判别力（ROC-AUC 约 0.66）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
- **视觉感知**：运动生动度、画面美感等感知评估具备**中等**判别力[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。

> **💡 面试洞察表达**：
> “在奖励模型的设计中，并非所有指标都需要参与正向激励。我们的策略是：将具备高置信度（高 ROC-AUC）的维度作为核心 Reward，而将判别力有限或属于客观缺陷的维度（如音频杂音）降级为底线约束（Constraint）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。这种解耦设计有效避免了模型在非关键特征上过度拟合（Reward Hacking），提升了最终生成结果的整体可用性。”

---



## 3. 输出结构与兜底工作流

评估模型通过规范化的输出契约将结果传递给训练流程[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。系统支持动态路由及打分聚合，最终将多维打分折叠为强化学习所需要的标量优势值（Scalar Advantage）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。

### 评估工作流

1. **输入解析**：模型解析原始 Prompt 与多模态参考素材，将意图拆解为细粒度的验证点（Verification Points）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
2. **实例级验证**：模型对生成内容进行全面扫描，对每一个验证点判定状态（满足、近似、未满足），并分配重要性等级（核心、重要、次要、细节）[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
3. **兜底门槛策略（Essential Gate）**：
  - 评估绝不是简单的算术平均。如果生成内容在“核心（Core）”意图上被判定为未满足（例如换了主体、做错了核心动作），该维度的评分也会被硬性限制在极低的分数区间[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。
4. **分数聚合**：经过验证器解析后，有效的质量分与约束扣分会被整合成单一标量分数，用于最终的梯度更新[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。

> **💡 面试洞察表达**：
> “为了提升评估模型的可解释性，我们将大模型的推理能力用在了‘生成实例级检查清单’上，而不是让它直接吐出一个黑盒分数[[1]](https://bytedance.larkoffice.com/docx/Y9t4dqcFWoTiEyxoOBtcxeA8nYb)。同时，我们引入了 Essential Gate（兜底门槛）机制，这非常关键——它避免了当生成内容发生‘核心意图偏离’时，系统由于其他次要维度的优秀表现而错误地给出中等甚至偏上评价，确保了 RL 训练方向的绝对正确性。”

