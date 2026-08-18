// Content scripts run in an isolated context; inject a script tag into the page DOM
// so the XHR/fetch patch runs in the page's JavaScript world (before any page scripts).
var s = document.createElement('script');
s.textContent = '(function(){window.__xrefael_patched=true;' +
  'var H="x-refael",V="7e8afcbdd3";' +
  'var oS=XMLHttpRequest.prototype.send;' +
  'XMLHttpRequest.prototype.send=function(){try{this.setRequestHeader(H,V);}catch(e){}return oS.apply(this,arguments);};' +
  'var oF=window.fetch;' +
  'window.fetch=function(input,init){' +
  'init=init||{};var h=init.headers;' +
  'if(h&&typeof h.set==="function"){h.set(H,V);}' +
  'else{init.headers=Object.assign({},h||{});init.headers[H]=V;}' +
  'return oF.call(window,input,init);};' +
  '})();';
document.documentElement.appendChild(s);
s.remove();
