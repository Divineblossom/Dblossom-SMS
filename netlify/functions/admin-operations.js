const { admin, userFrom, isAdmin, normPhone } = require("./_supabase");
const { notifyProfile } = require("./browser-notifications");
const crypto = require("crypto");
const ADMIN_COOKIE = "dblossom_admin_session";
function localAdmin(event){
  const raw=String(event.headers?.cookie||event.headers?.Cookie||"");
  const cookies={}; raw.split(";").forEach(p=>{const i=p.indexOf("=");if(i>0)cookies[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});
  const token=cookies[ADMIN_COOKIE]; if(!token||!process.env.ADMIN_PASSWORD)return null;
  const [payload,sig]=String(token).split("."); if(!payload||!sig)return null;
  const expected=crypto.createHmac("sha256",String(process.env.ADMIN_PASSWORD)).update(payload).digest("hex");
  if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
  try{const d=JSON.parse(Buffer.from(payload,"base64url").toString());if(d.role!=="admin"||!d.username||!d.iat)return null;if(Date.now()-Number(d.iat)>12*60*60*1000)return null;return{id:null,role:"admin",username:d.username,local:true}}catch{return null}
}

const clean = v => typeof v === "string" ? v.trim() : "";
const json = (statusCode, body) => ({ statusCode, headers: { "content-type":"application/json", "cache-control":"no-store" }, body: JSON.stringify(body) });
const safePage = event => Math.max(1, Number(event.queryStringParameters?.page || 1));
const safeSize = event => Math.min(100, Math.max(10, Number(event.queryStringParameters?.pageSize || 50)));

async function audit(db, user, action, entity_type, entity_id, details={}) {
  try { await db.from("audit_logs").insert({actor_profile_id:user?.id||null,action,entity_type,entity_id:entity_id?String(entity_id):null,details}); } catch (_) {}
}
async function getAuthEmail(db, profileId) {
  const { data } = await db.auth.admin.getUserById(profileId);
  return data?.user?.email || null;
}
function internalEmail(prefix, id) {
  const normalized = String(prefix).toLowerCase().replace(/[^a-z0-9_-]/g,"");
  return normalized + "." + String(id).replace(/[^a-z0-9]/gi,"").toLowerCase() + "@accounts.dblossom.local";
}
async function createOrUpdateAuth(db, { profileId, role, password, identifier, email }) {
  let authEmail = email || internalEmail(role, identifier);
  if (profileId) {
    if (password) {
      const { error } = await db.auth.admin.updateUserById(profileId, { password });
      if (error) throw error;
    }
    return { profileId, email: authEmail };
  }
  const { data, error } = await db.auth.admin.createUser({ email: authEmail, password, email_confirm: true });
  if (error) throw error;
  // Auth triggers may create the matching profiles row automatically. The caller
  // performs an upsert so we never attempt a second insert for the same profile ID.
  return { profileId:data.user.id, email:authEmail };
}
async function upsertProfile(db,id,full_name,role) {
  if(!id) return;
  // Auth creation runs the profile trigger before createUser returns. Update that
  // row first so account creation never performs a second profile INSERT.
  const {data:existing,error:lookupError}=await db.from("profiles").select("id").eq("id",id).maybeSingle();
  if(lookupError) throw lookupError;
  if(existing){const {error}=await db.from("profiles").update({full_name,role}).eq("id",id);if(error)throw error;return;}
  const {error}=await db.from("profiles").insert({id,full_name,role});
  if(error) throw error;
}
async function listData(db, table, page, pageSize, search, order="created_at", eventClassId="") {
  let q = db.from(table).select("*",{count:"exact"});
  if(search) {
    const s = search.replace(/[%_,]/g," ");
    if(table==="students") q=q.or("full_name.ilike.%"+s+"%,admission_number.ilike.%"+s+"%,guardian_name.ilike.%"+s+"%,guardian_contact.ilike.%"+s+"%");
    if(table==="contact_messages") q=q.or("name.ilike.%"+s+"%,subject.ilike.%"+s+"%,email.ilike.%"+s+"%,message.ilike.%"+s+"%");
    if(table==="teachers") q=q.or("full_name.ilike.%"+s+"%,staff_id.ilike.%"+s+"%");
  }
  if(table==="students" && eventClassId) q=q.eq("class_id",eventClassId);
  const from=(page-1)*pageSize,to=from+pageSize-1;
  q=q.order(order,{ascending:false,nullsFirst:false}).range(from,to);
  const {data,error,count}=await q;
  if(error) throw error;
  return {data:data||[],count:count||0,page,pageSize};
}

exports.handler = async event => {
  try {
    let user = await userFrom(event);
    if(!await isAdmin(user)) return json(401,{error:"Administrator session required."});
    const db=admin();
    // The custom Vercel admin cookie identifies the administrator as admin-local,
    // which is not a UUID and must never be written into UUID foreign-key columns.
    if(user?.adminSession && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(user.id||""))){
      const {data:adminProfile}=await db.from("profiles").select("id").in("role",["admin","super_admin"]).limit(1).maybeSingle();
      user={...user,id:adminProfile?.id||null};
    }
    if(event.httpMethod==="GET") {
      const p=safePage(event), size=safeSize(event), q=clean(event.queryStringParameters?.q), classId=clean(event.queryStringParameters?.class_id), table=clean(event.queryStringParameters?.table);
      if(table==="result_access_payments"){const{data,error,count}=await db.from("result_access_payments").select("id,student_id,term_id,reference,amount_kobo,currency,status,paystack_status,payer_name,payer_email,paid_at,created_at,students(full_name,admission_number),terms(name,academic_sessions(name))",{count:"exact"}).order("created_at",{ascending:false}).range((p-1)*size,p*size-1);if(error)throw error;return json(200,{data:data||[],count:count||0,page:p,pageSize:size});}
      if(table==="students"||table==="teachers"||table==="contact_messages"||table==="events"||table==="gallery_images"||table==="subjects"||table==="fee_payments"||table==="fee_invoices"||table==="announcements"||table==="admission_applications") {
        const result=await listData(db,table,p,size,q,table==="subjects"?"name":"created_at",classId);
      if(table==="fee_payments"){const {data,error,count}=await db.from("fee_payments").select("id,invoice_id,student_id,parent_id,amount,method,reference,status,paid_at,created_at,students(full_name,admission_number,class_id,classes(name))",{count:"exact"}).order("created_at",{ascending:false}).range((p-1)*size,p*size-1);if(error)throw error;return json(200,{data:data||[],count:count||0,page:p,pageSize:size});}
      if(table==="students"){
          const ids=[...new Set(result.data.map(x=>x.class_id).filter(Boolean))];
          const {data:classes}=ids.length?await db.from("classes").select("id,name").in("id",ids):{data:[]};
          const cm=new Map((classes||[]).map(x=>[x.id,x.name])); result.data=result.data.map(x=>({...x,class_name:cm.get(x.class_id)||"—"}));
        }
        if(table==="teachers"){
          const ids=result.data.map(x=>x.id).filter(Boolean);
          const {data:assignments}=ids.length?await db.from("teacher_assignments").select("teacher_id,class_id,subject_id,classes(id,name),subjects(id,name)").in("teacher_id",ids):{data:[]};
          const am=new Map((assignments||[]).map(x=>[x.teacher_id,x]));
          result.data=result.data.map(x=>{const a=am.get(x.id);return {...x,class_id:a?.class_id||null,class_name:a?.classes?.name||"—",subject_id:a?.subject_id||null,subject_name:a?.subjects?.name||"—"}});
        }
        if(table==="subjects"){
          const ids=[...new Set(result.data.map(x=>x.class_id).filter(Boolean))];
          const {data:classes}=ids.length?await db.from("classes").select("id,name").in("id",ids):{data:[]};
          const classNames=new Map((classes||[]).map(x=>[x.id,x.name]));
          result.data=result.data.map(x=>({...x,class_name:classNames.get(x.class_id)||"—"}));
        }
        return json(200,result);
      }
      if(table==="parents"){const{data,error,count}=await db.from("parent_profiles").select("id,profile_id,full_name,email,phone,status,address,occupation,created_at",{count:"exact"}).order("created_at",{ascending:false}).range((p-1)*size,p*size-1);if(error)throw error;let rows=data||[];if(q){const s=q.toLowerCase();rows=rows.filter(x=>[x.full_name,x.email,x.phone].some(v=>String(v||"").toLowerCase().includes(s)));}const ids=rows.map(x=>x.id);const{data:links}=ids.length?await db.from("parent_student_links").select("parent_id,student_id,relationship,is_primary,students(id,full_name,admission_number,class_id,classes(name))").in("parent_id",ids):{data:[]};const lm=new Map();(links||[]).forEach(l=>{if(!lm.has(l.parent_id))lm.set(l.parent_id,[]);if(l.students)lm.get(l.parent_id).push({...l.students,class_name:l.students.classes?.name||"—",relationship:l.relationship,is_primary:l.is_primary})});rows=rows.map(x=>({...x,children:lm.get(x.id)||[]}));if(event.queryStringParameters?.status)rows=rows.filter(x=>String(x.status||"").toLowerCase()===String(event.queryStringParameters.status).toLowerCase());return json(200,{data:rows,count:count||rows.length,page:p,pageSize:size});}
      if(table==="parent_messages"){const {data,error,count}=await db.from("parent_messages").select("id,parent_id,sender_profile_id,recipient_profile_id,student_id,subject,body,read_at,created_at,parent_profiles(full_name,email,phone,profile_id),students(full_name,admission_number)",{count:"exact"}).order("created_at",{ascending:false}).range((p-1)*size,p*size-1);if(error)throw error;return json(200,{data:data||[],count:count||0,page:p,pageSize:size});}
      if(table==="results") {
        const term=clean(event.queryStringParameters?.term), classId=clean(event.queryStringParameters?.class_id);
        const {data,error,count}=await db.from("results").select("id,student_id,subject_id,term_id,ca_score,exam_score,total_score,grade,teacher_comment,principal_comment,approved,created_at,students(full_name,admission_number,class_id,classes(name)),subjects(name),terms(name,session_id,academic_sessions(name))",{count:"exact"}).order("created_at",{ascending:false}).range((p-1)*size,p*size-1);
        if(error) throw error;
        let rows=data||[];
        if(term) rows=rows.filter(x=>x.terms?.name===term);
        if(classId) rows=rows.filter(x=>x.students?.class_id===classId);
        return json(200,{data:rows,count:count||0,page:p,pageSize:size});
      }
      if(table==="classes") { const {data,error}=await db.from("classes").select("id,name,is_active").order("name"); if(error)throw error; return json(200,{data:data||[],count:(data||[]).length}); }
      if(table==="terms") { const {data,error}=await db.from("terms").select("id,name,session_id,is_active,academic_sessions(name)").order("session_id"); if(error)throw error; return json(200,{data:data||[],count:(data||[]).length}); }
      if(table==="sessions") { const {data,error}=await db.from("academic_sessions").select("id,name,is_active").order("name",{ascending:false}); if(error)throw error; return json(200,{data:data||[],count:(data||[]).length}); }
      return json(400,{error:"Unsupported table."});
    }
    if(event.httpMethod!=="POST"&&event.httpMethod!=="PUT"&&event.httpMethod!=="DELETE") return json(405,{error:"Method Not Allowed"});
    const b=JSON.parse(event.body||"{}"), type=clean(b.type), id=clean(b.id);

    if(type==="student") {
      if(!clean(b.full_name)||!clean(b.admission_number)||(!id&&!clean(b.password))) return json(400,{error:"Full name, admission number and password are required for a new student."});
      if(!id&&clean(b.password).length<6)return json(400,{error:"Student portal password must be at least 6 characters."});
      if(id&&clean(b.password)&&clean(b.password).length<6)return json(400,{error:"Student portal password must be at least 6 characters."});
      
      const surname=(clean(b.full_name).split(/\s+/).filter(Boolean).pop()||"Student");const password=clean(b.password);
      let profileId=clean(b.profile_id)||null;
      if(!id) {
        const auth=await createOrUpdateAuth(db,{profileId:null,role:"student",password,identifier:b.admission_number,email:null});
        profileId=auth.profileId;
        await upsertProfile(db,profileId,clean(b.full_name),"student");
        const {data,error}=await db.from("students").insert({admission_number:clean(b.admission_number),full_name:clean(b.full_name),class_id:clean(b.class_id)||null,date_of_birth:b.date_of_birth||null,guardian_name:clean(b.guardian_name)||null,guardian_contact:clean(b.guardian_contact)||null,gender:clean(b.gender)||null,parent_email:clean(b.parent_email)||null,boarding_status:clean(b.boarding_status)||null,status:clean(b.status)||"active",profile_id:profileId}).select().single();
        if(error){await db.auth.admin.deleteUser(profileId);throw error}
        await audit(db,user,"create","student",data.id,{admission_number:data.admission_number});
        return json(201,{data});
      }
      const {data:old,error:oldError}=await db.from("students").select("profile_id").eq("id",id).maybeSingle();
      if(oldError)throw oldError;
      if(!old)return json(404,{error:"Student not found."});
      profileId=old.profile_id||null;
      if(!profileId&&!password)return json(400,{error:"This student has no portal login yet. Set a portal password here to create and link the login automatically."});
      if(password){
        if(profileId) await createOrUpdateAuth(db,{profileId,role:"student",password,identifier:b.admission_number});
        else { const auth=await createOrUpdateAuth(db,{profileId:null,role:"student",password,identifier:b.admission_number,email:null}); profileId=auth.profileId; }
      }
      const {data,error}=await db.from("students").update({admission_number:clean(b.admission_number),full_name:clean(b.full_name),class_id:clean(b.class_id)||null,date_of_birth:b.date_of_birth||null,guardian_name:clean(b.guardian_name)||null,guardian_contact:clean(b.guardian_contact)||null,gender:clean(b.gender)||null,parent_email:clean(b.parent_email)||null,boarding_status:clean(b.boarding_status)||null,status:clean(b.status)||"active",profile_id:profileId}).eq("id",id).select().single();
      if(error)throw error;
      if(profileId)await upsertProfile(db,profileId,data.full_name,"student");
      await audit(db,user,"update","student",id,{portal_account_linked:!!profileId,password_changed:Boolean(password)});
      return json(200,{data,portal_account_linked:!!profileId});
    }

    if(type==="teacher") {
      if(!clean(b.full_name)||!clean(b.staff_id)) return json(400,{error:"Full name and Staff ID are required."});
      if(!id&&!clean(b.password)) return json(400,{error:"Password is required for a new teacher."});
      if(clean(b.password)&&clean(b.password).length<6)return json(400,{error:"Teacher portal password must be at least 6 characters."});
      if(!id) {
        const auth=await createOrUpdateAuth(db,{profileId:null,role:"teacher",password:clean(b.password),identifier:b.staff_id,email:clean(b.email)||null});
        await upsertProfile(db,auth.profileId,clean(b.full_name),"teacher");
        const {data,error}=await db.from("teachers").insert({full_name:clean(b.full_name),staff_id:clean(b.staff_id),email:clean(b.email)||null,phone:clean(b.phone)||null,role:clean(b.role)||"Teaching Staff",status:clean(b.status)||"active",profile_id:auth.profileId}).select().single();
        if(error){await db.auth.admin.deleteUser(auth.profileId);throw error}
        if(clean(b.class_id)){const {error:ae}=await db.from("teacher_assignments").insert({teacher_id:data.id,class_id:clean(b.class_id),subject_id:clean(b.subject_id)||null});if(ae)throw ae;}
        await audit(db,user,"create","teacher",data.id,{staff_id:data.staff_id,class_id:clean(b.class_id)||null,subject_id:clean(b.subject_id)||null});return json(201,{data});
      }
      const {data:old}=await db.from("teachers").select("profile_id").eq("id",id).maybeSingle();if(!old)return json(404,{error:"Teacher not found."});
      let profileId=old.profile_id||null;
      if(clean(b.password)){
        if(profileId) await createOrUpdateAuth(db,{profileId,role:"teacher",password:clean(b.password),identifier:b.staff_id});
        else { const auth=await createOrUpdateAuth(db,{profileId:null,role:"teacher",password:clean(b.password),identifier:b.staff_id,email:clean(b.email)||null}); profileId=auth.profileId; }
      }
      const {data,error}=await db.from("teachers").update({full_name:clean(b.full_name),staff_id:clean(b.staff_id),email:clean(b.email)||null,phone:clean(b.phone)||null,role:clean(b.role)||"Teaching Staff",status:clean(b.status)||"active",profile_id:profileId}).eq("id",id).select().single();if(error)throw error;if(profileId)await upsertProfile(db,profileId,data.full_name,"teacher");
      if(b.class_id!==undefined||b.subject_id!==undefined){await db.from("teacher_assignments").delete().eq("teacher_id",id);if(clean(b.class_id)){const {error:ae}=await db.from("teacher_assignments").insert({teacher_id:id,class_id:clean(b.class_id),subject_id:clean(b.subject_id)||null});if(ae)throw ae;}}
      await audit(db,user,"update","teacher",id,{class_id:clean(b.class_id)||null,subject_id:clean(b.subject_id)||null});return json(200,{data});
    }

    if(type==="parent"){if(b.action==="delete"){const{data:old}=await db.from("parent_profiles").select("profile_id").eq("id",id).maybeSingle();if(!old)return json(404,{error:"Parent not found."});await db.from("parent_student_links").delete().eq("parent_id",id);const{error}=await db.from("parent_profiles").delete().eq("id",id);if(error)throw error;if(old.profile_id)await db.auth.admin.deleteUser(old.profile_id);await audit(db,user,"delete","parent",id,{});return json(200,{ok:true});}if(!clean(b.full_name)||!clean(b.email))return json(400,{error:"Parent name and email are required."});if(!id&&!clean(b.password))return json(400,{error:"Password is required for a new parent."});if(clean(b.password)&&clean(b.password).length<6)return json(400,{error:"Parent portal password must be at least 6 characters."});const status=clean(b.status)||"active";let parentId=id,profileId=null;if(!id){const auth=await createOrUpdateAuth(db,{profileId:null,role:"parent",password:clean(b.password),identifier:clean(b.email),email:clean(b.email)});profileId=auth.profileId;await upsertProfile(db,profileId,clean(b.full_name),"parent");const{data,error}=await db.from("parent_profiles").insert({profile_id:profileId,full_name:clean(b.full_name),email:clean(b.email),phone:clean(b.phone)||null,status,address:clean(b.address)||null,occupation:clean(b.occupation)||null}).select().single();if(error){await db.auth.admin.deleteUser(profileId);throw error}parentId=data.id;}else{const{data:old}=await db.from("parent_profiles").select("profile_id").eq("id",id).maybeSingle();if(!old)return json(404,{error:"Parent not found."});profileId=old.profile_id||null;if(clean(b.password)){if(profileId)await createOrUpdateAuth(db,{profileId,role:"parent",password:clean(b.password),identifier:clean(b.email),email:clean(b.email)});else{const auth=await createOrUpdateAuth(db,{profileId:null,role:"parent",password:clean(b.password),identifier:clean(b.email),email:clean(b.email)});profileId=auth.profileId;}}const{data,error}=await db.from("parent_profiles").update({profile_id:profileId,full_name:clean(b.full_name),email:clean(b.email),phone:clean(b.phone)||null,status,address:clean(b.address)||null,occupation:clean(b.occupation)||null}).eq("id",id).select().single();if(error)throw error;if(profileId)await upsertProfile(db,profileId,data.full_name,"parent");}await db.from("parent_student_links").delete().eq("parent_id",parentId);const ids=Array.isArray(b.student_ids)?b.student_ids.map(clean).filter(Boolean):[];if(ids.length){const{error:le}=await db.from("parent_student_links").insert(ids.map(student_id=>({parent_id:parentId,student_id,relationship:"Parent",is_primary:true})));if(le)throw le;}await audit(db,user,id?"update":"create","parent",parentId,{student_ids:ids});return json(id?200:201,{id:parentId});}
    if(type==="class") {
      if(b.action==="delete"){const {error}=await db.from("classes").delete().eq("id",id);if(error)throw error;await audit(db,user,"delete","class",id,{});return json(200,{ok:true});}
      if(!clean(b.name))return json(400,{error:"Class name is required."});
      const payload={name:clean(b.name),is_active:b.is_active!==false};
      const q=id?db.from("classes").update(payload).eq("id",id):db.from("classes").insert(payload);
      const {data,error}=await q.select().single();if(error)throw error;await audit(db,user,id?"update":"create","class",data.id,payload);return json(id?200:201,{data});
    }

    if(type==="delete") {
      if(!id||!clean(b.table))return json(400,{error:"Record and table are required."});
      const allowed=["students","teachers","results","events","gallery_images","subjects","admission_applications","announcements"];
      if(!allowed.includes(b.table))return json(400,{error:"Deletion is not allowed for this table."});
      const {data:row,error:lookupError}=await db.from(b.table).select("*").eq("id",id).maybeSingle();
      if(lookupError)throw lookupError;
      if(!row)return json(404,{error:"Record not found."});
      // Preserve referential integrity when removing a student: the schema restricts
      // deleting rows that still have attendance or result records.
      if(b.table==="students"){
        const {error:attendanceError}=await db.from("attendance").delete().eq("student_id",id);
        if(attendanceError)throw attendanceError;
        const {error:resultsError}=await db.from("results").delete().eq("student_id",id);
        if(resultsError)throw resultsError;
      }
      const {error}=await db.from(b.table).delete().eq("id",id);
      if(error)throw error;
      if((b.table==="students"||b.table==="teachers")&&row.profile_id){
        const {error:authDeleteError}=await db.auth.admin.deleteUser(row.profile_id);
        if(authDeleteError)throw authDeleteError;
      }
      await audit(db,user,"delete",b.table,id,{portal_account_removed:b.table==="students"||b.table==="teachers"});
      return json(200,{ok:true,deleted_id:id});
    }

    if(type==="message-send"){const parentId=clean(b.parent_id),studentId=clean(b.student_id),body=clean(b.body);if(!parentId||!body)return json(400,{error:"Parent and message are required."});const{data:parent}=await db.from("parent_profiles").select("id,profile_id").eq("id",parentId).maybeSingle();if(!parent?.profile_id)return json(404,{error:"Parent account not found."});if(studentId){const{data:link}=await db.from("parent_student_links").select("student_id").eq("parent_id",parentId).eq("student_id",studentId).maybeSingle();if(!link)return json(403,{error:"That student is not linked to this parent."});}const{data,error}=await db.from("parent_messages").insert({parent_id:parentId,sender_profile_id:user.id||null,recipient_profile_id:parent.profile_id,student_id:studentId||null,subject:"School Administration",body}).select().single();if(error)throw error;await notifyProfile(db,parent.profile_id,{title:"New message from school administration",body:"The school administrator sent you a message. Open Messages to reply.",url:"/pages/school-messages.html?role=parent&recipient=admin",tag:"admin-parent-message"});await audit(db,user,"create","parent_message",data.id,{parent_id:parentId,student_id:studentId||null});return json(201,{data});}
    if(type==="message-status"){if(!id)return json(400,{error:"Message ID is required."});const status=clean(b.status);const patch=status==="Read"?{read_at:new Date().toISOString()}:status==="Unread"?{read_at:null}:null;if(!patch)return json(400,{error:"Invalid message status."});const{data,error}=await db.from("parent_messages").update(patch).eq("id",id).select().single();if(error)throw error;await audit(db,user,"update","parent_message",id,{status});return json(200,{data});}
    if(type==="message-reply"){if(!id||!clean(b.body))return json(400,{error:"Message and reply are required."});const{data:msg}=await db.from("parent_messages").select("parent_id,student_id,subject").eq("id",id).maybeSingle();if(!msg)return json(404,{error:"Message not found."});const{data:parent}=await db.from("parent_profiles").select("profile_id").eq("id",msg.parent_id).maybeSingle();if(!parent?.profile_id)return json(400,{error:"Parent account not found."});const{data,error}=await db.from("parent_messages").insert({parent_id:msg.parent_id,sender_profile_id:user.id,recipient_profile_id:parent.profile_id,student_id:msg.student_id,subject:clean(b.subject)||"Re: "+(msg.subject||"School message"),body:clean(b.body)}).select().single();if(error)throw error;await db.from("parent_messages").update({read_at:new Date().toISOString()}).eq("id",id);await notifyProfile(db,parent.profile_id,{title:"Reply from school administration",body:"The school administrator replied to your message. Open Messages to read it.",url:"/pages/school-messages.html?role=parent&recipient=admin",tag:"admin-parent-reply"});await audit(db,user,"create","parent_message",data.id,{reply_to:id});return json(201,{data});}
    if(type==="payment-status"){const status=["Confirmed","Rejected","Pending"].includes(b.status)?b.status:null;if(!status||!id)return json(400,{error:"Valid payment status and payment ID are required."});const{data,error}=await db.from("fee_payments").update({status,paid_at:status==="Confirmed"?new Date().toISOString():null}).eq("id",id).select().single();if(error)throw error;await audit(db,user,"update","fee_payment",id,{status});return json(200,{data});}
    if(type==="announcement"){if(b.action==="delete"){if(!b.id)return json(400,{error:"Announcement ID is required."});const{error}=await db.from("announcements").delete().eq("id",b.id);if(error)throw error;await audit(db,user,"delete","announcement",b.id,{});return json(200,{ok:true})}if(!clean(b.title)||!clean(b.body))return json(400,{error:"Announcement title and body are required."});const rawAudience=clean(b.audience)||"all";const audience=({"everyone":"all","parents":"parent","students":"student","teachers":"teacher","class":"class","student":"student","parent":"parent","teacher":"teacher","all":"all"})[rawAudience.toLowerCase()];if(!audience)return json(400,{error:"Choose Everyone, Students, Teachers or Parents as the audience."});const payload={title:clean(b.title),body:clean(b.body),posted_by:user.id||null,audience,target_class_id:clean(b.target_class_id)||null,target_student_id:clean(b.target_student_id)||null,pinned:b.pinned===true||b.pinned==="true",status:clean(b.status)||"Published"};const q=b.id?db.from("announcements").update(payload).eq("id",b.id):db.from("announcements").insert(payload);const{data,error}=await q.select().single();if(error)throw error;await audit(db,user,b.id?"update":"create","announcement",data.id,{});return json(b.id?200:201,{data});}
    if(type==="upload-document"){const raw=String(b.data||""),mime=String(b.mime||"");if(!/^(application\/pdf|image\/(png|jpeg|jpg|webp))$/.test(mime)||!raw.startsWith("data:"))return json(400,{error:"Only PDF, PNG, JPG and WEBP files are supported."});const buffer=Buffer.from(raw.split(",")[1]||"","base64");if(buffer.length>3.5*1024*1024)return json(400,{error:"File must be 3.5MB or smaller."});const ext=mime==="application/pdf"?"pdf":mime==="image/jpeg"||mime==="image/jpg"?"jpg":mime.split("/")[1],key="documents/"+Date.now()+"-"+Math.random().toString(36).slice(2,10)+"."+ext,bucket=process.env.SUPABASE_STORAGE_BUCKET||"school-media";const{error}=await db.storage.from(bucket).upload(key,buffer,{contentType:mime,upsert:false});if(error)throw error;return json(200,{key,url:"/api/manus-storage/"+encodeURIComponent(key),size:buffer.length});}if(type==="upload-image"){const raw=String(b.data||"");const mime=String(b.mime||"");if(!/^image\/(png|jpeg|jpg|webp|gif)$/.test(mime)||!raw.startsWith("data:"))return json(400,{error:"Only PNG, JPG, WEBP and GIF images are supported."});const base64=raw.split(",")[1]||"";const buffer=Buffer.from(base64,"base64");if(buffer.length>4*1024*1024)return json(400,{error:"Image must be 5MB or smaller."});const ext=mime==="image/jpeg"||mime==="image/jpg"?"jpg":mime.split("/")[1];const key=(clean(b.kind)||"uploads")+"/"+Date.now()+"-"+Math.random().toString(36).slice(2,10)+"."+ext;const bucket=process.env.SUPABASE_STORAGE_BUCKET||"school-media";const{error}=await db.storage.from(bucket).upload(key,buffer,{contentType:mime,upsert:false});if(error)throw error;const publicUrl=db.storage.from(bucket).getPublicUrl(key)?.data?.publicUrl;if(!publicUrl)throw new Error("Could not create a public URL for the uploaded image.");return json(200,{key,url:publicUrl});}
    if(type==="event"){if(!clean(b.title)||!b.event_date)return json(400,{error:"Event title and date are required."});const payload={title:clean(b.title),description:clean(b.description),event_date:b.event_date,category:clean(b.category)||"Other",status:clean(b.status)||"Published",image_url:clean(b.image_url)||null,created_by:user.id||null};const{data,error}=id?await db.from("events").update(payload).eq("id",id).select().single():await db.from("events").insert(payload).select().single();if(error)throw error;await audit(db,user,id?"update":"create","event",data.id,{});return json(id?200:201,{data});}
    if(type==="gallery"){if(!clean(b.title)||!clean(b.image_url))return json(400,{error:"Gallery title and image URL are required."});const payload={title:clean(b.title),alt_text:clean(b.alt_text)||clean(b.title),image_url:clean(b.image_url),category:clean(b.category)||"Other",created_by:user.id||null};const{data,error}=id?await db.from("gallery_images").update(payload).eq("id",id).select().single():await db.from("gallery_images").insert(payload).select().single();if(error)throw error;await audit(db,user,id?"update":"create","gallery_image",data.id,{});return json(id?200:201,{data});}
    if(type==="subject"){if(!clean(b.name))return json(400,{error:"Subject name is required."});const{data,error}=id?await db.from("subjects").update({name:clean(b.name),class_id:clean(b.class_id)||null}).eq("id",id).select().single():await db.from("subjects").insert({name:clean(b.name),class_id:clean(b.class_id)||null}).select().single();if(error)throw error;await audit(db,user,id?"update":"create","subject",data.id,{});return json(id?200:201,{data});}
    if(type==="result"){if(!clean(b.student_id)||!clean(b.subject_id)||!clean(b.term_id))return json(400,{error:"Student, subject and term are required."});const ca=Number(b.ca_score),exam=Number(b.exam_score);if(!Number.isFinite(ca)||!Number.isFinite(exam)||ca<0||ca>30||exam<0||exam>70)return json(400,{error:"CA must be 0-30 and Exam must be 0-70."});const total=ca+exam,grade=total>=70?"A":total>=60?"B":total>=50?"C":total>=40?"D":"F";const payload={student_id:b.student_id,subject_id:b.subject_id,term_id:b.term_id,ca_score:ca,exam_score:exam,total_score:total,grade,teacher_comment:clean(b.teacher_comment)||null,principal_comment:clean(b.principal_comment)||null,approved:Boolean(b.approved),recorded_by:null};const {data,error}=id?await db.from("results").update(payload).eq("id",id).select().single():await db.from("results").insert(payload).select().single();if(error)throw error;await audit(db,user,id?"update":"create","result",data.id,{});return json(id?200:201,{data});}
    if(type==="invoice"){const studentId=clean(b.student_id),items=Array.isArray(b.items)?b.items:[];if(!studentId||!items.length)return json(400,{error:"Student and at least one fee item are required."});const normalized=items.map(x=>({category_id:clean(x.category_id),description:clean(x.description)||"School fee",amount:Math.max(0,Number(x.amount||0))}));const{data,error}=await db.rpc("create_fee_invoice",{p_student_id:studentId,p_invoice_number:clean(b.invoice_number)||"INV-"+Date.now(),p_due_date:clean(b.due_date)||null,p_notes:clean(b.notes)||null,p_items:normalized,p_created_by:user.id||null});if(error)return json(400,{error:error.message});return json(201,{data});}
    if(type==="payment"){const amount=Number(b.amount);if(!id||!Number.isFinite(amount)||amount<=0)return json(400,{error:"Invoice and a valid payment amount are required."});const{data,error}=await db.rpc("record_fee_payment",{p_invoice_id:id,p_amount:amount,p_method:clean(b.method)||"Manual",p_reference:clean(b.reference)||"MANUAL-"+Date.now(),p_parent_id:clean(b.parent_id)||null});if(error)return json(400,{error:error.message});return json(201,{data});}
    if(type==="contact-status"){if(!id)return json(400,{error:"Contact enquiry ID is required."});const allowed=["New","Read","Resolved"];if(!allowed.includes(b.status))return json(400,{error:"Invalid contact status."});const{data,error}=await db.from("contact_messages").update({status:b.status}).eq("id",id).select().single();if(error)throw error;await audit(db,user,"update","contact_message",id,{status:b.status});return json(200,{data});}
    if(type==="admission-status"){if(!id)return json(400,{error:"Application ID is required."});const allowed=["Pending","Under Review","Interview","Approved","Rejected"];if(!allowed.includes(b.status))return json(400,{error:"Invalid admission status."});const crypto=require("crypto");let issuedKey=null;const payload={status:b.status,notes:clean(b.notes)||null,interview_date:b.interview_date||null,interview_notes:clean(b.interview_notes)||null,reviewed_by:user.id||null,updated_at:new Date().toISOString()};if(b.status==="Approved"){issuedKey=clean(b.admission_key)||("DBMS-"+crypto.randomBytes(4).toString("hex").toUpperCase());payload.admission_key_hash=crypto.createHash("sha256").update(issuedKey.trim().toUpperCase()).digest("hex");}else{payload.admission_key_hash=null;}const{data,error}=await db.from("admission_applications").update(payload).eq("id",id).select().single();if(error)throw error;await audit(db,user,"update","admission_application",id,{status:b.status,admission_key_issued:Boolean(issuedKey)});return json(200,{data,admission_key:issuedKey});}
    return json(400,{error:"Unsupported administrator operation."});
  } catch(e) { console.error(e); return json(500,{error:e.message||"Administrator operation could not be completed."}); }
};