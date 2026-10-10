const menu=document.querySelector("#menu-button");
const nav=document.querySelector("#mobile-nav");
function closeMenu(){if(!menu||!nav)return;nav.classList.remove("open");menu.setAttribute("aria-expanded","false");menu.innerHTML="☰ <span>Menu</span>"}
if(menu&&nav){menu.addEventListener("click",()=>{const open=nav.classList.toggle("open");menu.setAttribute("aria-expanded",String(open));menu.innerHTML=open?"✕ <span>Close</span>":"☰ <span>Menu</span>"});nav.querySelectorAll("a").forEach(link=>link.addEventListener("click",closeMenu));document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()})}
document.querySelectorAll(".floating-whatsapp").forEach(a=>a.remove());