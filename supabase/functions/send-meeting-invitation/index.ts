// Secure meeting invitation email sender for BRF Umeälven
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const SMTP_HOST = "smtp.3dg.se";
const SMTP_PORT = 465;
const SMTP_USERNAME = Deno.env.get("SMTP_USERNAME");
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD");
const FROM = "BRF Umeälven – Styrelseportalen <info@brfumealven.se>";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function response(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {status,headers:{...corsHeaders,"Content-Type":"application/json"}});
}
function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;',"'":"&#39;"}[c]!));
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return response({error:"Method not allowed"},405);
  try {
    const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
    if(!token) return response({error:"Unauthorized"},401);
    const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!anon||!service||!SMTP_USERNAME||!SMTP_PASSWORD) throw new Error("Missing server configuration");
    const userClient=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
    const {data:userData,error:userError}=await userClient.auth.getUser();
    if(userError||!userData.user) return response({error:"Unauthorized"},401);
    const {data:isAdmin,error:roleError}=await userClient.rpc("current_user_is_admin");
    if(roleError||isAdmin!==true) return response({error:"Forbidden"},403);
    const body=await req.json();
    const meetingId=String(body?.meetingId||"");
    if(!meetingId||meetingId.length>100) return response({error:"Invalid meeting"},400);
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const {data:meeting,error:meetingError}=await admin.from("meetings").select("*").eq("id",meetingId).maybeSingle();
    if(meetingError||!meeting) return response({error:"Meeting not found"},404);
    const {data:agenda,error:agendaError}=await admin.from("agenda_items").select("*").eq("meeting_id",meetingId).order("created_at",{ascending:true});
    if(agendaError) throw new Error("Agenda lookup failed");
    const {data:members,error:membersError}=await userClient.rpc("get_active_board_members");
    if(membersError||!Array.isArray(members)||!members.length) throw new Error("Active board members unavailable");
    const memberIds=[...new Set(members.map((m:any)=>m.user_id).filter(Boolean))];
    const emails:string[]=[];
    for(let page=1;page<=20;page++){
      const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
      if(error||!data?.users) throw new Error("User lookup failed");
      for(const u of data.users) if(memberIds.includes(u.id)&&u.email) emails.push(u.email);
      if(data.users.length<1000) break;
    }
    const recipients=[...new Set(emails)];
    if(!recipients.length) throw new Error("No active board member email addresses");
    const title=meeting.title||meeting.name||"Styrelsemöte";
    const date=meeting.meeting_date ? new Date(meeting.meeting_date).toLocaleDateString("sv-SE") : "Ej angivet";
    const sections:any={};
    for(const item of agenda||[]){
      const section=String(item.section_number??item.section??item.paragraph??"");
      if(!sections[section])sections[section]=[];
      sections[section].push(item);
    }
    const agendaHtml=Object.keys(sections).sort((a,b)=>Number(a)-Number(b)).map(section=>
      "<li><strong>§"+esc(section)+"</strong><ul>"+sections[section].map((item:any)=>"<li>"+esc(item.title||"Dagordningspunkt")+(item.description?" — "+esc(item.description):"")+"</li>").join("")+"</ul></li>"
    ).join("");
    const html="<div style='font-family:Arial,sans-serif;color:#24313c;max-width:700px;margin:auto'><h1 style='color:#17324d'>Kallelse till styrelsemöte</h1><p>Härmed kallas styrelsens ledamöter till möte.</p><div style='background:#eef4f8;padding:16px;border-left:5px solid #245b83'><p><b>Möte:</b> "+esc(title)+"</p><p><b>Datum:</b> "+esc(date)+"</p><p><b>Tid:</b> "+esc(meeting.meeting_time||"Ej angiven")+"</p><p><b>Plats:</b> "+esc(meeting.location||"Ej angiven")+"</p></div>"+(meeting.notes?"<h2>Information</h2><p>"+esc(meeting.notes).replace(/\n/g,"<br>")+"</p>":"")+"<h2>Dagordning</h2><ol>"+agendaHtml+"</ol><p>Vänligen registrera ditt svar i Styrelseportalen.</p><p>Välkomna!</p><p>Tobias Janze<br>Ordförande, BRF Umeälven</p></div>";
    const textBody="Kallelse till styrelsemöte\n\nMöte: "+title+"\nDatum: "+date+"\nTid: "+(meeting.meeting_time||"Ej angiven")+"\nPlats: "+(meeting.location||"Ej angiven")+"\n\n"+(meeting.notes||"")+"\n\nDagordning:\n"+(agenda||[]).map((i:any)=>"§"+(i.section_number??i.section??i.paragraph??"")+" "+(i.title||"")+(i.description?"\n"+i.description:"")).join("\n")+"\n\nVänligen registrera ditt svar i Styrelseportalen.\n\nTobias Janze\nOrdförande, BRF Umeälven";
    const transporter=nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:true,auth:{user:SMTP_USERNAME,pass:SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
    await transporter.sendMail({from:FROM,to:FROM,bcc:recipients,subject:"Kallelse – "+title,text:textBody,html});
    try{await admin.from("board_activity_log").insert({event_type:"meeting_invitation_sent",meeting_id:String(meeting.id),meeting_label:title,summary:"Kallelse skickad via e-post till "+recipients.length+" styrelsemedlemmar",section_label:"E-postutskick",created_by:userData.user.id});}catch(_){}
    return response({success:true,recipientCount:recipients.length});
  }catch(e){console.error("Meeting invitation send failed",e);return response({error:"Utskicket kunde inte genomföras. Kontrollera mottagare och serverlogg."},500);}
});
