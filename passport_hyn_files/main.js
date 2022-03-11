function defineMethod(type, method, fn) {
	if (method in type.prototype)
		return;
	Object.defineProperty(type.prototype, method, { writable: true, configurable: true, enumerable: false, value: fn });
}

defineMethod(String, 'startsWith', function(str) {
	var str = String(str);
	return this.length >= str.length && this.substring(0, str.length) === str;
});

;(function(){
	var atob = window.atob;
	var btoa = window.btoa;
	window.atob = function(arg){
		return fromUtf8(atob(arg));
	};
	window.btoa = function(arg){
		try { return btoa(arg); }catch(e){
		try { return btoa(toUtf8(arg)); }catch(ee){throw e;}}
	};
})();

/**
 * 如果字符串开头有bom，则将字符串作为utf-8解析
 */
function fromUtf8(str) {
	str = String(str);
	var bom = String.fromCharCode(0xEF, 0xBB, 0xBF);
	if (!str.startsWith(bom))
		return str;
	var buf = [''];
	for (var i=3; i<str.length; i++) {
		buf.push(str[i].charCodeAt(0).toString(16));
	}
	return decodeURIComponent(buf.join('%'));
}

/**
 * 将字符串转为utf-8再转回utf-16，并在前面加上bom作为标识
 */
function toUtf8(str) {
	str = String(str);
	var bom = String.fromCharCode(0xEF, 0xBB, 0xBF);
	if (str.startsWith(bom))
		return str;
	return bom + encodeURIComponent(str).replace(/%([a-fA-F0-9]{2})/g, function(g0, g1) {
		return String.fromCharCode(parseInt(g1, 16));
	});
}

/**
 * 输入内容合法性检查
 * 在需要检查的元素class属性中，添加属性值 checked
 * label属性为需要提示的内容，
 * 如果不写label，分别取前一个td的文本值，当前input的name、id
 * @returns {Boolean}
 */
function checkAll(root) {
	var regexps = {
		decimal : /^\d+\.?\d*$/,
		decimalOption : /^\d+\.?\d*$|^$/,
		email : /^([\w\.\-])+\@(([\w\-])+\.)+([a-z]{2,4})+$/,
		emailOption : /^([\w\.\-])+\@(([\w\-])+\.)+([a-z]{2,4})+$|^$/,
		tel : /^\+?\d{1,10}-?\d{1,11}-?\d{0,10}$/,
		telOption : /^\+?\d{1,10}-?\d{5,11}$|^$/
	};
	var warnMsg = "";
	$(".checked:not([disabled])", root || document).each(function() {
		var $this = $(this);
		var label = $this.data('label') ||  $this.attr("data-label") || $this.attr("label") 
				|| $this.attr('title') || $this.parent().prev().text() || $this.attr("name") || $this.attr("id");
		if (!label) {
			console.warn('未知输入项错误');
			return;
		}
		label = label.replace(/^[ *]+|[ :：]+$/g, "").replace(/\s+/g, ' ');
		var regexAttr = $this.data("regex") || $this.attr("data-regex") || $this.attr("regex");
		if (regexAttr) {
			var regex = regexps[regexAttr] || regexAttr;
			if (!$this.val().match(regex))
				warnMsg += label + '格式不正确\n';
		}
		else if (!$this.val()) {
			warnMsg += label + '不能为空\n';
		}
	});
	if (warnMsg) {
		alert(warnMsg);
		return false;
	}
	return true;
}

$.fn.extend({
	/**
	 * 将roots数组中的元素取出，然后以当前节点下的.v-it子节点为模板进行渲染
	 */
	iterate : function(roots, parent) {
		var $it = $('.v-it', this);
		$it.each(function(){
			var rts = roots;
			if (!rts && !(rts = parent && parent[this.dataset.vitl]))
				return;
			$(this).siblings('.v-ited').remove();
			var html = $(this).is('script') ? this.innerHTML : this.outerHTML;
			var $last = $it;
			for (var i in rts) {
				if (isNaN(i)) continue;
				var root = $.extend({"$i" : i}, rts[i]);
				$last = $(prcTpl(html, root)).removeClass('v-it').addClass('v-ited').insertAfter($last);
				$last.iterate();
			}
		});
		return $(this);
	}
});
/**
 * 渲染数据
 * 对于templateStr = 'Hello, {{name}}', root = { name : "Tom" }
 * 会输出 'Hello, Tom'
 */
defineMethod(String, 'prcTpl', function(data) { return prcTpl(this, data) });
function prcTpl(templateStr, root, cfg) {
	cfg = cfg || {};
	return templateStr.replace(/{{[^}]+}}/g, function(e){
		var expr = e.substring(2, e.length-2);
		var result;
		if (expr.match(/^[\w\$\.]+$/))
			result = getDotted(root, expr);
		else with (root)
			result = eval(expr);
		result = toString(result);
		return cfg.raw ? result : escapeHtml(result);
	});
	function toString(arg) {
		switch (typeof arg) {
		case 'object'  : return arg ? JSON.stringify(arg) : '';
		case 'string'  : return arg;
		case 'number'  : return arg.toString();
		case 'boolean' : return arg.toString();
		case 'function': throw  new Error('not implemented');
		default        : return arg ? String(arg) : '';
		}
	}
	function escapeHtml(arg) {
		return arg.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
	}
}

/**
 * root 根节点
 * expr 从根节点中取值的表达式
 * type 取出的值的期望类型
 * defaultVal 取出的值不符合期望时的默认值
 * eg.
 *  getDotted(window, "location.href") === window.location.href
 *  getDotted(window, "location.ferh", "number", 101) === 101
 */
function getDotted(root, expr, type, defaultVal) {
	type || (defaultVal = undefined);
	expr = expr.split('.');
	for (var i in expr) {
		root = root[expr[i]];
		if (root == undefined)
			return defaultVal;
	}
	return (type && (typeof root !== type || root === null && type === 'object') ) ? defaultVal : root;
}

var native_alert = alert;
alert = bs_alert;
function bs_alert(msg, callback) {
	if (typeof msg === 'string' || msg instanceof String) {
		msg = msg.replace(/</g,'&lt;');
	} else if (msg) {
		console.log('alert msg must be a string')
		msg = '';
	} else {
		msg = '';
	}
	// 多行数据拆分成多条
	var msgs = msg.split(/\n/g)
	if (msgs.length > 1) {
		var nmsg = 0
		for (var i in msgs)
			if (msgs[i].trim()) {
				nmsg++
				alert(msgs[i], function(){
					--nmsg || callback && callback()
				})
			}
		if (nmsg) return
	}
	$('.alert2bg').show()
	var html = '<div class="alert2"><p>' + msg + '</p><div class="btnGroup"><a class="yes">关 闭</a></div></div>'
	var $box = $(html)
	$box.appendTo('body').find('.yes').click(function(){
		$box.remove()
		$('.alert2').length || $('.alert2bg').hide()
		callback && callback()
	})
}

function bs_confirm(msg, callback_yes, callback_no) {
	if (typeof msg === 'string' || msg instanceof String) {
		msg = msg.replace(/</g,'&lt;');
	} else if (msg) {
		console.log('confirm msg must be a string')
		msg = '';
	} else {
		msg = '';
	}
	$('.alert2bg').show()
	var html = '<div class="alert2"><p>' + msg + '</p><div class="btnGroup"><a class="yes">  是  </a><a class="no">  否  </a></div></div>'
	var $box = $(html)
	$box.appendTo('body').find('.yes').click(function(){
		$box.remove()
		$('.alert2').length || $('.alert2bg').hide()
		callback_yes && callback_yes()
	});
	$box.find('.no').click(function(){
		$box.remove()
		$('.alert2').length || $('.alert2bg').hide()
		callback_no && callback_no()
	})
}

/**
 * 点击Close关闭页面
 * @param msg
 */
function alertCW(msg) {
	var html = '<div class="alert2"><p>' + msg + '</p><div class="btnGroup"><a class="yes">关 闭</a></div></div>'; 
	var $box = $(html); 
	$box.appendTo('body').find('.yes').click(function(){ 
		window.close(); 
	}); 	
}  

/**
 * Simple Apollo Local Storage
 * 将页面上所有input的val储存在localStorage中
 */
;(function(){
	var selector = 'input, select, textarea, [data-sals]'
	var filter = ':not(:button):not([data-sals-transient])'
	window.sals = {
		save : function(context, root) {
			var result = {}
			var key = 0
			$(selector, root || document).filter(filter).each(function(){
				var $this = $(this)
				var name = $this.data('sals') || $this.attr('id') || $this.attr('name') || ('_sals' + key++)
				result[noConflict(name, result)] =
					$this.is(':checkbox, :radio') ? $this.prop('checked') : 
					$this.is('select') ? $this.val() : 
					$this.val() || $this.text()
			})
			localStorage['sals_' + context] = JSON.stringify(result)
		},
		load : function(context, root, change) {
			var sals = localStorage['sals_' + context]
			if (!sals)
				return
			var result = JSON.parse(sals)
			var key = 0
			var $doms = $(selector, root || document)
			var names = {}
			$doms.filter(filter).each(function(){
				var $this = $(this)
				var name = $this.data('sals') || $this.attr('id') || $this.attr('name') || ('_sals' + key++)
				names[name = noConflict(name, names)] = true
				if (typeof result[name] !== 'undefined')
					if ($this.is(':checkbox, :radio'))
						$this.prop('checked', result[name] == true)
					else {
						$this.val(result[name])
						if (! $this.is('select, textarea')) $this.text(result[name])
					}
			})
			if (change)
				(change === true ? $doms : $doms.filter(change)).each(function() {
					$(this).change()
			})
		},
		clear : function(context) {
			localStorage['sals_' + context] = ''
			delete localStorage['sals_' + context]
		}
	};
	function noConflict(key, existedKeys) {
		var splitedKey = key.match(/(.*?)(\d*)$/)
		var root = splitedKey[1], i = splitedKey[2];
		while (typeof existedKeys[key = root + i] !== 'undefined')
			i++;
		return key;
	}
})();

/**
 * Date 格式化
 * 例如：new Date().format("MMM.dd,yyyy, HH:mm:ss");
 *     new Date().format("yyyy-MM-dd HH:mm:ss");
 */
defineMethod(Date, 'format', function(mask) { 
    var d = this;
    var zeroize = function (value, length) {
            if (!length) length = 2;
            value = String(value);
            for (var i = 0, zeros = ''; i < (length - value.length); i++) {
                zeros += '0';
            }
            return zeros + value;
        };
    return mask.replace(/"[^"]*"|'[^']*'|\b(?:d{1,4}|M{1,4}|yy(?:yy)?|([hHmstT])\1?|[lLZ])\b/g, function($0) {
        switch ($0) {
        case 'd':		return d.getDate();
        case 'dd':		return zeroize(d.getDate());
        case 'ddd':		return ['Sun', 'Mon', 'Tue', 'Wed', 'Thr', 'Fri', 'Sat'][d.getDay()];
        case 'dddd':	return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
        case 'M':		return d.getMonth() + 1;
        case 'MM':		return zeroize(d.getMonth() + 1);
        case 'MMM':		return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
        case 'MMMM':	return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()];
        case 'yy':		return String(d.getFullYear()).substr(2);
        case 'yyyy':	return d.getFullYear();
        case 'h':		return d.getHours() % 12 || 12;
        case 'hh':		return zeroize(d.getHours() % 12 || 12);
        case 'H':		return d.getHours();
        case 'HH':		return zeroize(d.getHours());
        case 'm':		return d.getMinutes();
        case 'mm':		return zeroize(d.getMinutes());
        case 's':		return d.getSeconds();
        case 'ss':		return zeroize(d.getSeconds());
        case 'l':		return zeroize(d.getMilliseconds(), 3);
        case 'L':		var m = d.getMilliseconds(); if (m > 99) m = Math.round(m / 10); return zeroize(m);
        case 'tt':		return d.getHours() < 12 ? 'am' : 'pm';
        case 'TT':		return d.getHours() < 12 ? 'AM' : 'PM';
        case 'Z':		return d.toUTCString().match(/[A-Z]+$/);
        default:		return $0.substr(1, $0.length - 2);
        }
    });
});

;(function($) {
	var oldAjax = $.ajax;
	$.ajax = function(arg) {
		return oldAjax($.extend({}, arg, {
			success : function(data) {
				if (typeof data === 'string' && data.match(/^\s*<!-- LOGIN -->/)) {
					alert('会话超时，请重新登录', function() {
						location.reload();
					});
				} else {
					arg.success && arg.success.apply(this, [].slice.call(arguments));
				}
			},
			error : function(xhr) {
				if (xhr.responseText && xhr.responseText.match(/^\s*<!-- LOGIN -->/)) {
					alert('会话超时，请重新登录', function() {
						location.reload();
					});
				} else {
					arg.error && arg.error.apply(this, [].slice.call(arguments));
				}
			}
		}));
	}
})(jQuery);

;(function($) {
	document.addEventListener('DOMNodeInserted', hook, false);
	document.addEventListener('DOMAttrModified', hook, false);
//	document.addEventListener('DOMNodeRemoved', hook, false);
	function hook() {
		Tasks.doOnceLater('set-modal-draggable', function() {
/*			$(".modal").draggable({
				cursor: "move",
				handle: ".modal-header"
			});*/
		});
	}
})(jQuery);

var Tasks = {
	pending: {},
	locked: {},
	/**
	 * 提交一个任务，稍后执行。若同一ID的不同任务连续提交，只有最后一个会被执行
	 * @param taskId :string 任务ID
	 * @param task :function 要执行的任务
	 */
	doOnceLater: function(taskId, task) {
		Tasks.doOnceAfter(taskId, 0, task);
	},
	/**
	 * 提交一个任务，延迟指定时间执行。若同一ID的不同任务连续提交，只有最后一个会被执行
	 * @param taskId :string 任务ID
	 * @param timeout :number 延迟时间（毫秒）
	 * @param task :function 要执行的任务
	 */
	doOnceAfter: function(taskId, timeout, task) {
		if (taskId in Tasks.pending) {
			clearTimeout(Tasks.pending[taskId]);
		}
		Tasks.pending[taskId] = setTimeout(function(){
			delete Tasks.pending[taskId];
			task();
		}, timeout);
	},
	/**
	 * 开启一个异步任务。若同一ID的不同任务连续提交，只有最后一个的结果会被采纳
	 * @param taskId :string 任务ID
	 * @param then :function 接受最终任务结果的回调函数
	 * @returns :function 接受各任务结果的回调函数
	 */
	doOnceAsync: function(taskId, then) {
		var mylock = (Tasks.locked[taskId] || 0) + 1;
		Tasks.locked[taskId] = mylock;
		return function(){
			if (Tasks.locked[taskId] == mylock) {
				Tasks.locked[taskId] = null;
				then.apply(this, arguments);
			}
		}
	}
}

//验证码
var lastcaptcha = 0;
$(document).on('click', '.captcha-image', function() {
	var i = ++lastcaptcha;
	$('.captcha-image').attr('src', 'data:image/jpeg,');
	$.ajax({
		url:'/supplierHandle/pullCaptcha.base64',//若其他地方也使用到，请加selector， url无所谓。
		success: function(img){
			if (lastcaptcha != i)
				return;
			var dataurl = 'data:image/jpeg;base64,' + img;
			$('.captcha-image').attr('src', dataurl);
		}
	});
});

function reset(args){
	$(args.parentSelector).find(args.resetWhich).val(args.resetValue);
}

function justNum(e){
	return [8,9,37,39,46].indexOf(e.keyCode) >= 0
		|| e.keyCode - 48 <= 9 && e.keyCode - 48 >= 0
		|| e.keyCode - 96 >= 0 && e.keyCode - 96 <= 9;
}
function justDecimal(e){
	return e.keyCode==110||e.keyCode==190||justNum(e);
}

/** 
 * 返回前一页（或关闭本页面） 
 * <li>如果没有前一页历史，则直接关闭当前页面</li> 
 */  
function goBack(){  
    if ((navigator.userAgent.indexOf('MSIE') >= 0) && (navigator.userAgent.indexOf('Opera') < 0)){ // IE  
        if(history.length > 0){  
            window.history.go( -1 );  
        }else{  
            window.opener=null;window.close();  
        }  
    }else{ //非IE浏览器  
        if (navigator.userAgent.indexOf('Firefox') >= 0 ||  
            navigator.userAgent.indexOf('Opera') >= 0 ||  
            navigator.userAgent.indexOf('Safari') >= 0 ||  
            navigator.userAgent.indexOf('Chrome') >= 0 ||  
            navigator.userAgent.indexOf('WebKit') >= 0){  
  
            if(window.history.length > 1){  
                window.history.go( -1 );  
            }else{  
                window.opener=null;window.close();  
            }  
        }else{ //未知的浏览器  
            window.history.go( -1 );  
        }  
    }  
} 

/**
 * 冻结、释放按钮
 */
$.fn.extend({
	freezeBtns:function (){
		$(this).attr('disabled',"true");
	},
	releaseBtns:function (){
		$(this).removeAttr("disabled");
	}
});

function range(from, to, fn) {
	var arr = [];
	for (var i=0; i<=to-from; i++) {
		arr.push(fn ? fn(from + i) : from + i);
	}
	return arr;
}

var dateFormats = {
	FullYear: 'yyyy',
	Month: 'yyyy-MM',
	Date: 'yyyy-MM-dd',
	Hours: 'yyyy-MM-dd HH',
	Minutes: 'yyyy-MM-dd HH:mm',
	Secounds: 'yyyy-MM-dd HH:mm:ss'
};
$(document).on('click', '.time-btn .prev', function(e) {
	var t = $(e.target).parent().find('.Wdate');
	t.val(dateStrAddInt(t.val(), -1)).change();
});
$(document).on('click', '.time-btn .next', function(e) {
	var t = $(e.target).parent().find('.Wdate');
	t.val(dateStrAddInt(t.val(), 1)).change();
});
function dateStrAddInt(d, n) {
	var date = new Date(d);
	if (isNaN(date.getYear())) {
		return d;
	}
	var field, fmt;
	for (var i in dateFormats) {
		if (d.length == dateFormats[i].length) {
			field = i;
			fmt = dateFormats[i];
		}
	}
	if (!field) {
		return d;
	}
	date['set' + field](date['get' + field]() + n);
	return date.format(fmt);
}

function doUpload(file, path) {
	var form = new FormData();
	form.set('file', file);
	form.set('path', path);
	return new Promise(function(rs, rj) {
		$.ajax({
			url: '/upload',
			type: 'post',
			data: form,
			processData: false,
			contentType: false,
			success: function(){
				// alert(file.name + ' 上传成功');
				rs();
			},
			error: function(){
				alert(file.name + ' 上传失败');
				rj();
			}
		});
	});
};

function addListenInputNumber() {
	var all_input = $("input");
	all_input.each(function() {
		var isNumber = $(this).attr("data-number");
		if (isNumber) {
			$(this).on('input', function() {
				$(this).val($(this).val().replace(/[^0-9.]/g,''));
			})
		}
	})
}

function checkForm() {
	var all_input = $("input");
	var flag = true;
	all_input.each(function() {
		var requirt = $(this).attr("data-require");
		if (requirt && $.trim($(this).val()).length == 0) {
			alert("请输入" + $(this).attr("data-des"));
			flag = false;
			return false;
		}
		var max = $(this).attr("data-max");
		if (max) {
			if($(this).val().length > Number(max)) {
				alert($(this).attr("data-des")+ "长度不能超过" + max);
				flag = false;
				return false;
			}
		}
		var min = $(this).attr("data-min");
		if (min) {
			if($(this).val().length < Number(min)) {
				alert($(this).attr("data-des")+ "长度不能少于" + min);
				flag = false;
				return false;
			}
		}
		
	});
	return flag;
}

/*function initTime() {
	//初始化时间控件
	var currYear = (new Date()).getFullYear();	
	var opt={};
	opt.date = {preset : 'date'};
	opt.datetime = {preset : 'datetime'};
	opt.time = {preset : 'time'};
	opt.default = {
		theme: 'android-ics light', //皮肤样式
        display: 'modal', //显示方式 
        mode: 'scroller', //日期选择模式
		dateFormat: 'yyyy-mm-dd',
		lang: 'zh',
		showNow: true,
		nowText: "今天",
        startYear: currYear, //开始年份
        endYear: currYear + 1 //结束年份
	};
  	var optDateTime = $.extend(opt['datetime'], opt['default']);
    return optDateTime;
}

Array.prototype.remove = function(val) {
	var index = this.indexOf(val);
	if (index > -1) {
	this.splice(index, 1);
	}
};*/
