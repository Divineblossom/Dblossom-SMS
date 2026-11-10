const{createClient}=require("@supabase/supabase-js");
function admin(){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;let key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key&&process.env.SUPABASE_SECRET_KEYS){try{key=JSON.parse(process.env.SUPABASE_SECRET_KEYS).default}catch{}}if(!url||!key)throw new Error("Supabase server credentials are not configured.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
async function userFrom(event){
 const h=event.headers?.authorization||event.headers?.Authorization||"";
 // A real signed-in portal user's bearer token must take precedence over the
 // administrator cookie. The admin cookie can belong to a different session
 // in the same browser and its profileId may be null.
 if(h){
  if(!h.startsWith("Bearer "))return null;
  const{data,error}=await admin().auth.getUser(h.slice(7));
  return error||!data.user?null:data.user;
 }
 const rawCookie=event.headers?.cookie||event.headers?.Cookie||"";
 const cookieMatch=String(rawCookie).match(/(?:^|;\s*)dblossom_admin_session=([^;]+)/);
 const ah=event.headers?.["x-admin-session"]||event.headers?.["X-Admin-Session"]||"";
 const token=ah||(cookieMatch?decodeURIComponent(cookieMatch[1]):"");
 if(!token)return null;
 const crypto=require("crypto"),secret=process.env.ADMIN_PASSWORD;
 if(!secret)return null;
 const p=String(token).split(".");
 if(p.length!==2)return null;
 const expected=crypto.createHmac("sha256",secret).update(p[0]).digest("hex");
 if(p[1].length!==expected.length||!crypto.timingSafeEqual(Buffer.from(p[1]),Buffer.from(expected)))return null;
 try{
  const x=JSON.parse(Buffer.from(p[0],"base64url").toString());
  if(x.role!=="admin"||!x.username||!x.iat||Date.now()-Number(x.iat)>12*60*60*1000)return null;
  const profileId=String(x.profileId||"");
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId);
  return{id:uuid?profileId:null,username:String(x.username),email:"administrator@dblossom.local",adminSession:true};
 }catch{return null}
}
async function isAdmin(user){if(!user)return false;if(user.adminSession===true)return true;const{data}=await admin().from("profiles").select("role").eq("id",user.id).maybeSingle();return !!data&&["admin","super_admin"].includes(String(data.role))}
function normPhone(v){let d=String(v||"").replace(/\D/g,"");if(d.startsWith("234")&&d.length>=13)d=d.slice(3);if(d.length===10)d="0"+d;return d}
function internalEmail(prefix,id){return String(prefix).toLowerCase().replace(/[^a-z0-9_-]/g,"")+"."+String(id).replace(/[^a-z0-9]/gi,"").toLowerCase()+"@accounts.dblossom.local"}
const attempts=new Map();
const limiter={blocked(key){const a=attempts.get(key);if(!a)return false;if(Date.now()-a.t>15*60*1000){attempts.delete(key);return false}return a.n>=8},fail(key){const a=attempts.get(key);if(!a||Date.now()-a.t>15*60*1000)attempts.set(key,{n:1,t:Date.now()});else a.n++},clear(key){attempts.delete(key)}};
const clientIp=e=>String(e.headers?.["x-nf-client-connection-ip"]||e.headers?.["x-forwarded-for"]||"").split(",")[0].trim()||"unknown";
module.exports={admin,userFrom,isAdmin,normPhone,internalEmail,limiter,clientIp};
