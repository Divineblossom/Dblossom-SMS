(function(){
  "use strict";
  const KEY="dbms-theme";
  const read=()=>{try{return localStorage.getItem(KEY)==="dark"?"dark":"light"}catch(_){return "light"}};
  function apply(theme){
    const dark=theme==="dark";
    document.documentElement.dataset.theme=dark?"dark":"light";
    if(document.body){
      document.body.dataset.theme=dark?"dark":"light";
      if(document.body.classList.contains("portal-dashboard")||document.body.dataset.role==="admin")document.body.dataset.adminTheme=dark?"dark":"light";
    }
    document.querySelectorAll("[data-theme-toggle]").forEach(button=>{
      button.textContent=dark?"☀":"☾";
      button.setAttribute("aria-label",dark?"Switch to light mode":"Switch to dark mode");
      button.title=dark?"Switch to light mode":"Switch to dark mode";
      button.setAttribute("aria-pressed",String(dark));
    });
    try{localStorage.setItem(KEY,dark?"dark":"light")}catch(_){}
  }
  function mount(){
    if(!document.body)return;
    const admin=document.querySelector("#admin-theme-toggle");
    if(admin){
      document.querySelectorAll(".dbms-theme-toggle").forEach(button=>button.remove());
      admin.dataset.themeToggle="true";
      apply(read());
      return;
    }
    const hosts=document.querySelectorAll(".nav-wrap,.portal-head-actions,.student-header-actions,.portal-login-card");
    hosts.forEach(host=>{
      if(host.querySelector("[data-theme-toggle]"))return;
      const button=document.createElement("button");
      button.type="button";
      button.className="dbms-theme-toggle";
      button.dataset.themeToggle="true";
      button.addEventListener("click",()=>apply(document.documentElement.dataset.theme==="dark"?"light":"dark"));
      host.appendChild(button);
    });
    if(document.querySelector("[data-theme-toggle]"))apply(read());
  }
  function start(){apply(read());mount()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();