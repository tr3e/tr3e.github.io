$(document).ready(function(){
	
	//去掉文本框输入首尾空格
    $("input[type='text'], input:not([type])").blur(function(){ 
    	$(this).val($.trim($(this).val())); 
    }); 
   
    //禁止粘贴
    $(".no-paste").bind("paste", function(){
    	return false; 
    });  
    
    //输入整数
    $(".integer").bind("keypress", function(){
    	var keyCode = event.keyCode; 
        if ((keyCode >= 48 && keyCode <= 57)) { 
             event.returnValue = true; 
        } else { 
             event.returnValue = false; 
        } 
    }); 
    
    //输入整数或小数
    $(".decimal").bind("keypress", function(){
    	var keyCode = event.keyCode;  
        if ((keyCode >= 48 && keyCode <= 57 || keyCode == 46)) { 
        		event.returnValue = false; 
            event.returnValue = true; 
        } else { 
            event.returnValue = false; 
        }     	
    }); 
});  


/**
 * 非空校验
 * @returns {Boolean}
 */
function notEmpty() {
	var flag = true;
    $(".not-empty").each(function(){
		if($(this).val()==""){
			alert($(this).attr("title") + " cannot be empty.");
			flag = false;
			return false;
		} 
	}); 
	return flag;	
}

/** 非负整数 */
function isPositiveInteger(val) {
	return /^(0|[1-9]\d*)$/.test(val);
}

/** 非负数 */
function isPositiveNumber(val) {
	return /^(([1-9]\d*(\.\d+){0,1})|([0](\.\d+){0,1}))$/.test(val); 
}

function isEmpty(val) {
	if (val == undefined || val == 'undefined' || val == null || val == '')
		return true; 
	return false; 
}

function isNotEmpty(val) {
	return ! isEmpty(val); 
} 

function basicCheck2(){ 	
	return checkNotEmpty() && checkInteger() && checkNumber(); 
}  

/**
 * 非空校验
 * @returns {Boolean}
 */
function checkNotEmpty() {
	var len = $(".notNull").length; 
	for (var i=0; i<len; i++) {
		var ele = $(".notNull:eq("+i+")"); 
		if (isEmpty(ele.val())) {
			alert(ele.attr("title") + " cannot be empty.");
			return false; 
		}
	}
	return true; 
}

/**
 * 正整数校验
 * @returns {Boolean}
 */
function checkInteger() {
	var len = $(".integer").length; 
	for (var i=0; i<len; i++) {
		var val = $(".integer:eq("+i+")").val(); 
		if(isNotEmpty(val) && !isPositiveInteger(val)){
			alert(val + " is not a valid integer.");
			return false; 
		} 
	}
	return true; 
}

/**
 * 正数校验
 * @returns {Boolean}
 */
function checkNumber() {
	var len = $(".decimal").length; 
	for (var i=0; i<len; i++) {
		var val = $(".decimal:eq("+i+")").val(); 
		if(isNotEmpty(val) && !isPositiveNumber(val)){
			alert(val + " is not a valid number.");
			return false; 
		} 
	} 
	return true; 	
}

/**
 * 数字格式化 三位一逗号,保留两位小数
 * @param nStr
 * @returns
 */
function addCommas(nStr){
    nStr += '';
    x = nStr.split('.');
    x1 = x[0];
    x2 = x.length > 1 ? '.' + x[1] : '';
    var rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1)) {
     x1 = x1.replace(rgx, '$1' + ',' + '$2');
    }
    return x1 + x2;
}

/**
 * 自动补齐两位小数
 */
function returnFloat(value){
	var value=Math.round(parseFloat(value)*100)/100;
	var xsd=value.toString().split(".");
	if(xsd.length==1){
	value=value.toString()+".00";
		return value;
	}
	if(xsd.length>1){
		if(xsd[1].length<2){
	 		value=value.toString()+"0";
	 	}
	 	return value;
	}
}

/**
 * 遮罩
 * MaskUtil.add();// 加遮罩
 * MaskUtil.remove();// 去除遮罩
 */
var MaskUtil = {
    add: function(){ // 添加遮罩
        var left = ($(window).width()-37)/2;
         var top = ($(window).height()-37)/2;
         var html =
            "<div id='maskDiv' style='z-index:9999;border:0px solid red; position:fixed; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0); opacity:0.6; filter:alpha(opacity=60);'>"
            +"<img src='/images/loading2.gif' style='border:0px solid red; position:absolute; left:"+left+"px; top:"+top+"px;'/>"
            +"</div>";
        $("body").append(html);
    },
    remove: function(){ // 移除遮罩
        $("#maskDiv").remove();
    }
};
