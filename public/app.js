const $ = id => document.getElementById(id);
let appPassword = sessionStorage.getItem("rps_password") || "";
const privateFetch = (url, options={}) => fetch(url, {
  ...options, headers: { ...(options.headers||{}), "x-app-password": appPassword }
});
function status(id, message){ $(id).textContent = message; }
function esc(s){ return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function unlock(){
  appPassword = $("password").value;
  try{
    const r = await privateFetch("/api/private/references?q=test");
    if(r.status===401) throw Error("Password incorrect.");
    if(r.status===503) throw Error("Server setup incomplete. Configure APP_PASSWORD.");
    sessionStorage.setItem("rps_password",appPassword);
    $("login").hidden=true; $("workspace").hidden=false;
  }catch(e){status("loginMsg",e.message);}
}
$("unlock").onclick=unlock;
$("password").addEventListener("keydown",e=>{if(e.key==="Enter")unlock()});
$("lock").onclick=()=>{sessionStorage.removeItem("rps_password");appPassword="";$("workspace").hidden=true;$("login").hidden=false;$("password").value="";};
document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  document.querySelectorAll(".view").forEach(x=>x.hidden=x.id!==btn.dataset.view);
});
async function postJSON(url,data){
  const r=await privateFetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");return d;
}
$("generate").onclick=async()=>{
  const topic=$("topic").value.trim();if(!topic){status("writerStatus","Please enter a research topic.");return;}
  $("generate").disabled=true;status("writerStatus","Generating your manuscript. This may take a little time…");
  try{
    const d=await postJSON("/api/private/generate",{
      topic,discipline:$("discipline").value,paperType:$("paperType").value,style:$("style").value,
      section:$("section").value,length:$("length").value,objective:$("objective").value,
      method:$("method").value,findings:$("findings").value,references:$("references").value,useWeb:$("useWeb").checked
    });
    $("output").value=d.text;status("writerStatus",`Draft generated using ${d.model}. ${d.webResearch?"Web research was enabled.":"Web research was not enabled."} Verify all sources and factual claims.`);
  }catch(e){status("writerStatus",e.message)}
  finally{$("generate").disabled=false;}
};
$("saveDraft").onclick=()=>{
  const ids=["topic","discipline","paperType","style","section","length","objective","method","findings","references","output"];
  const d={};ids.forEach(id=>d[id]=$(id).value);d.useWeb=$("useWeb").checked;
  localStorage.setItem("rps_draft",JSON.stringify(d));status("writerStatus","Draft saved in this browser on this device.");
};
$("loadDraft").onclick=()=>{
  const d=JSON.parse(localStorage.getItem("rps_draft")||"null");if(!d){status("writerStatus","No saved draft found in this browser.");return;}
  Object.keys(d).forEach(k=>{if($(k)&&k!=="useWeb")$(k).value=d[k]});$("useWeb").checked=!!d.useWeb;status("writerStatus","Draft loaded.");
};
$("clearDraft").onclick=()=>{if(confirm("Clear the editor and form fields?")){document.querySelectorAll("#writer input:not([type=checkbox]),#writer textarea").forEach(x=>x.value="");status("writerStatus","Fields cleared. Saved browser draft remains until you clear browser storage.");}};
$("copyOutput").onclick=async()=>{await navigator.clipboard.writeText($("output").value);status("writerStatus","Manuscript copied to clipboard.");};
$("export").onclick=async()=>{
  try{
    const r=await privateFetch("/api/private/export-docx",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("topic").value||"Research Manuscript",body:$("output").value})});
    if(!r.ok){const d=await r.json();throw Error(d.error)}
    const blob=await r.blob();downloadBlob(blob,"research-manuscript.docx");
  }catch(e){status("writerStatus",e.message)}
};
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);}
$("searchRefs").onclick=async()=>{
  status("refStatus","Searching Crossref…");$("refResults").innerHTML="";
  try{
    const r=await privateFetch("/api/private/references?q="+encodeURIComponent($("refQuery").value));
    const d=await r.json();if(!r.ok)throw Error(d.error);
    status("refStatus",`${d.items.length} metadata records returned. Verify relevance and publication details.`);
    d.items.forEach(x=>{
      const div=document.createElement("div");div.className="reference";
      div.innerHTML=`<b>${esc(x.title)}</b><br><small>${esc(x.authors)} · ${esc(String(x.year))} · ${esc(x.journal)}</small><br>${x.doi?`DOI: <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.doi)}</a>`:"DOI not listed"}`;
      const add=document.createElement("button");add.className="secondary refactions";add.textContent="Add to references";add.onclick=()=>{
        const entry=`${x.authors} (${x.year}). ${x.title}. ${x.journal}. ${x.doi?x.url:""}`.trim();
        $("references").value=($("references").value?$("references").value+"\n":"")+entry;
      };div.appendChild(add);$("refResults").appendChild(div);
    });
  }catch(e){status("refStatus",e.message)}
};
$("reviewBtn").onclick=async()=>{
  $("reviewBtn").disabled=true;status("reviewStatus","Reviewing manuscript…");
  try{const d=await postJSON("/api/private/review",{manuscript:$("reviewText").value});$("reviewOutput").value=d.text;status("reviewStatus","Review report generated. Treat it as editorial assistance, not an actual journal decision.");}
  catch(e){status("reviewStatus",e.message)}finally{$("reviewBtn").disabled=false;}
};
$("convert").onclick=async()=>{
  const f=$("manuscript").files[0];if(!f){status("formatStatus","Please select a DOCX manuscript.");return;}
  const fd=new FormData();fd.append("manuscript",f);fd.append("style",$("formatStyle").value);
  $("convert").disabled=true;status("formatStatus","Extracting text and reformatting…");
  try{
    const r=await privateFetch("/api/private/format",{method:"POST",body:fd});
    if(!r.ok){const d=await r.json();throw Error(d.error||"Conversion failed.");}
    downloadBlob(await r.blob(),$("formatStyle").value.toLowerCase().replace(/\s+/g,"-")+"-reflowed.docx");
    status("formatStatus","DOCX generated. Check it against the official journal/conference template and restore figures, tables and equations as needed.");
  }catch(e){status("formatStatus",e.message)}finally{$("convert").disabled=false;}
};
fetch("/api/health").then(r=>r.json()).then(d=>{$("modelPill").textContent=d.aiConfigured?"AI configured · "+d.model:"API key not configured";}).catch(()=>{$("modelPill").textContent="Backend unavailable";});
if(appPassword){$("password").value=appPassword;unlock();}
