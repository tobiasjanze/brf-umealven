// Secure PDF meeting invitation sender for BRF Umeälven
// Required secrets: SMTP_USERNAME, SMTP_PASSWORD, SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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
    const meetingTitleFromClient=typeof body?.meetingTitle==="string"?body.meetingTitle.slice(0,200):"Styrelsemöte";
    const pdfBase64=typeof body?.pdfBase64==="string"?body.pdfBase64:"";
    const fileName=typeof body?.fileName==="string"?body.fileName:"Kallelse.pdf";
    if(!meetingId||meetingId.length>100||!pdfBase64||pdfBase64.length>11_000_000) return response({error:"Invalid request"},400);
    // Reject non-PDF payloads; base64 PDF begins with JVBERi0.
    if(!pdfBase64.startsWith("JVBERi0")) return response({error:"Invalid PDF"},400);
    const pdfBytes=Uint8Array.from(atob(pdfBase64),c=>c.charCodeAt(0));
    if(pdfBytes.length<100||pdfBytes.length>8*1024*1024) return response({error:"Invalid PDF size"},400);
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const selectedIds=Array.isArray(body?.recipientUserIds)?[...new Set(body.recipientUserIds.filter((id:any)=>typeof id==="string"))]:[];
    if(!selectedIds.length||selectedIds.length>200) return response({error:"Invalid recipient selection"},400);
    const {data:members,error:membersError}=await userClient.rpc("get_active_board_members");
    if(membersError||!Array.isArray(members)||!members.length) throw new Error("Active board members unavailable");
    const activeIds=[...new Set(members.map((m:any)=>m.user_id).filter((id:any)=>typeof id==="string"))];
    if(selectedIds.some((id:string)=>!activeIds.includes(id))) return response({error:"Invalid or inactive recipient"},403);
    const memberIds=selectedIds;
    const emails:string[]=[];
    for(let page=1;page<=20;page++){
      const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
      if(error||!data?.users) throw new Error("User lookup failed");
      for(const u of data.users) if(memberIds.includes(u.id)&&u.email) emails.push(u.email);
      if(data.users.length<1000) break;
    }
    const recipients=[...new Set(emails.map(e=>e.trim()).filter(Boolean))];
    if(!recipients.length) throw new Error("No active board member email addresses");
    const title=meetingTitleFromClient||"Styrelsemöte";
    const transporter=nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:true,auth:{user:SMTP_USERNAME,pass:SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
    await transporter.sendMail({
      from:FROM,to:FROM,bcc:recipients,subject:"Kallelse – "+title,
      text:"Härmed skickas kallelsen till "+title+". Se bifogad PDF.\n\nVänligen registrera din närvaro i styrelseportalen.",
      attachments:[{filename:fileName.replace(/[^a-zA-Z0-9åäöÅÄÖ _.-]/g,"_").slice(0,120),content:pdfBytes,contentType:"application/pdf"}]
    });
    try {
      await admin.from("board_activity_log").insert({event_type:"meeting_invitation_sent",meeting_id:meetingId,meeting_label:title,summary:"PDF-kallelse skickad via e-post till "+recipients.length+" valda styrelsemedlemmar",section_label:"E-postutskick",created_by:userData.user.id});
    } catch(logError) { console.warn("Activity log write failed",logError); }
    return response({success:true,recipientCount:recipients.length});
  }catch(e){console.error("Meeting PDF invitation send failed",e);return response({error:"Utskicket kunde inte genomföras. Kontrollera mottagare och serverlogg."},500);}
});
