function openDialog({title="Please confirm",message="",mode="confirm",defaultValue="",placeholder="",confirmText="Continue",danger=false}={}) {
 return new Promise(resolve => {
  document.querySelector(".dbms-dialog-backdrop")?.remove();
  const backdrop=document.createElement("div");
  backdrop.className="dbms-dialog-backdrop";
  backdrop.innerHTML='<section class="dbms-dialog" role="dialog" aria-modal="true" aria-labelledby="dbms-dialog-title"><div class="dbms-dialog-icon '+(danger?"is-danger":"")+'">'+(danger?"!":mode==="prompt"?"✎":mode==="alert"?"i":"?")+'</div><h2 id="dbms-dialog-title"></h2><p class="dbms-dialog-message"></p>'+(mode==="prompt"?'<input class="dbms-dialog-input" type="text">':"")+'<div class="dbms-dialog-actions">'+(mode==="alert"?"":'<button type="button" class="btn btn-outline" data-dialog-cancel>Cancel</button>')+'<button type="button" class="btn '+(danger?"danger-btn":"navy-btn")+'" data-dialog-confirm></button></div></section>';
  backdrop.querySelector("#dbms-dialog-title").textContent=title;
  backdrop.querySelector(".dbms-dialog-message").textContent=message;
  const input=backdrop.querySelector(".dbms-dialog-input");
  if(input){input.value=defaultValue;input.placeholder=placeholder;input.setAttribute("aria-label",title)}
  const yes=backdrop.querySelector("[data-dialog-confirm]"),no=backdrop.querySelector("[data-dialog-cancel]");
  yes.textContent=confirmText;
  document.body.append(backdrop);
  let finished=false;
  const finish=value=>{if(finished)return;finished=true;document.removeEventListener("keydown",onKey);backdrop.remove();resolve(value)};
  const onKey=e=>{if(e.key==="Escape")finish(mode==="prompt"?null:false);if(e.key==="Enter"&&mode==="prompt"&&document.activeElement===input){e.preventDefault();finish(input.value)}};
  no?.addEventListener("click",()=>finish(mode==="prompt"?null:false));
  yes.addEventListener("click",()=>finish(mode==="prompt"?input.value:true));
  backdrop.addEventListener("click",e=>{if(e.target===backdrop)finish(mode==="prompt"?null:false)});
  document.addEventListener("keydown",onKey);
  (input||yes).focus();
 });
}
export const confirmAction=(message,options={})=>openDialog({message,...options,mode:"confirm"});
export const promptAction=(message,options={})=>openDialog({message,...options,mode:"prompt"});

export const alertAction=(message,options={})=>openDialog({message,...options,mode:"alert",confirmText:options.confirmText||"OK"});
