// =====================
// Cognito SPA (PKCE) – minimal client-side auth
// =====================

// ---- AUTH CONFIG ----
// TODO: COGNITO_DOMAIN - your Managed Login/Hosted UI domain
const COGNITO_DOMAIN = "https://us-east-2xvjeuuayn.auth.us-east-2.amazoncognito.com"; // ← placeholder
// TODO: COGNITO_CLIENT_ID - your App Client ID (Public client)
const COGNITO_CLIENT_ID = "7jt9bgu03in136n5d50l893j6t"; // ← placeholder
// TODO: REDIRECT_URI - must exactly match Allowed callback URL (include trailing slash if used)
const REDIRECT_URI = "http://localhost:3000/"; // ← placeholder
// TODO: LOGOUT_URI - must match Allowed sign-out URL
const LOGOUT_URI = "http://localhost:3000/"; // ← placeholder
const OAUTH_SCOPES = ["openid", "email"];

// ---- API CONFIG ----
// TODO: API_BASE - your API Gateway base URL (no trailing slash), e.g. https://abc123.execute-api.us-east-2.amazonaws.com/prod
const API_BASE = "https://ovhzgjj862.execute-api.us-east-2.amazonaws.com"; // no trailing slash
// TODO: REGION - AWS region for your stack (used only for docs, not code logic)
const AWS_REGION = "<REGION>"; // ← placeholder
// --------------------

// Storage
const TOKENS_KEY = "cog_tokens_v1";
function saveTokens(tokens){ sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)); }
function loadTokens(){ try { return JSON.parse(sessionStorage.getItem(TOKENS_KEY) || ""); } catch { return null; } }
function clearTokens(){ sessionStorage.removeItem(TOKENS_KEY); }

// Helpers
function base64UrlEncode(buf){
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function base64UrlDecode(str){
  str=str.replace(/-/g,"+").replace(/_/g,"/");
  const pad=str.length%4?4-(str.length%4):0;
  return atob(str+"=".repeat(pad));
}
function parseJwt(token){
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  return JSON.parse(base64UrlDecode(parts[1]));
}

// PKCE
function randomString(bytes=32){
  const arr=new Uint8Array(bytes); crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>("0"+b.toString(16)).slice(-2)).join("");
}
async function sha256Plain(text){
  const data=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest("SHA-256",data);
  return new Uint8Array(digest);
}
async function buildLoginUrl(){
  const codeVerifier=randomString(64);
  sessionStorage.setItem("pkce_verifier", codeVerifier);
  const challengeBytes=await sha256Plain(codeVerifier);
  const codeChallenge=base64UrlEncode(challengeBytes);
  const params=new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: codeChallenge
  });
  return `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}
async function startLogin(e){ e?.preventDefault(); window.location.assign(await buildLoginUrl()); }
function startLogout(e){
  e?.preventDefault(); clearTokens();
  const params=new URLSearchParams({ client_id: COGNITO_CLIENT_ID, logout_uri: LOGOUT_URI });
  window.location.assign(`${COGNITO_DOMAIN}/logout?${params.toString()}`);
}
async function exchangeCodeForTokens(authCode){
  const verifier=sessionStorage.getItem("pkce_verifier");
  if(!verifier) throw new Error("Missing PKCE verifier in sessionStorage");
  const body=new URLSearchParams({
    grant_type:"authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code: authCode,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });
  const res=await fetch(`${COGNITO_DOMAIN}/oauth2/token`,{
    method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body
  });
  if(!res.ok){ const txt=await res.text().catch(()=> ""); throw new Error(`Token exchange failed: ${res.status} ${txt}`); }
  const tokens=await res.json(); saveTokens(tokens); sessionStorage.removeItem("pkce_verifier");
}
function updateAuthUI(){
  const loginBtn=document.getElementById("loginBtn");
  const logoutBtn=document.getElementById("logoutBtn");
  const userInfo=document.getElementById("userInfo");
  const tokens=loadTokens();
  if(tokens?.id_token){
    const claims=parseJwt(tokens.id_token)||{};
    const email=claims.email||"(signed in)";
    const groups=claims["cognito:groups"]||[];
    const roleStr=groups.length?` – ${groups.join(", ")}`:"";
    if(userInfo){ userInfo.textContent=`${email}${roleStr}`; userInfo.style.display="inline"; }
    if(logoutBtn) logoutBtn.style.display="inline-block";
    if(loginBtn) loginBtn.style.display="none";
  } else {
    if(userInfo) userInfo.style.display="none";
    if(logoutBtn) logoutBtn.style.display="none";
    if(loginBtn) loginBtn.style.display="inline-block";
  }
}
async function handleAuthOnLoad(){
  const url=new URL(window.location.href);
  const code=url.searchParams.get("code");
  if(code){
    try{ await exchangeCodeForTokens(code); } catch(err){ console.error(err); alert("Login failed. Please try again."); }
    url.searchParams.delete("code");
    history.replaceState({}, "", url.pathname + (url.search?("?"+url.search):"") + url.hash);
  }
  updateAuthUI();
}
document.addEventListener("DOMContentLoaded", handleAuthOnLoad);

// Auth helpers
window.auth = {
  getIdToken: ()=> loadTokens()?.id_token || null,
  getAccessToken: ()=> loadTokens()?.access_token || null,
  isOwnerOrEditor: ()=>{
    const idt = loadTokens()?.id_token; if(!idt) return false;
    const groups=(parseJwt(idt)||{})["cognito:groups"]||[];
    return groups.includes("owners") || groups.includes("editors");
  }
};

// --------------------
// API helpers (uses API_BASE; attaches access token for writes)
// --------------------
const api = {
  async getProperties(q){
    const params = new URLSearchParams();
    if (q?.available !== undefined) params.set('available', String(q.available));
    if (q?.beds) params.set('beds', String(q.beds));
    if (q?.baths) params.set('baths', String(q.baths));
    if (q?.maxPrice) params.set('maxPrice', String(q.maxPrice));
    const res = await fetch(`${API_BASE}/properties${params.toString()?("?"+params.toString()):""}`, {
      method:"GET",
      headers:{ "Accept":"application/json" }
    });
    if(!res.ok) throw new Error(`GET /properties failed: ${res.status}`);
    return res.json();
  },
  async createProperty(payload){
    const at = window.auth.getAccessToken();
    if(!at) throw new Error("Not authenticated");
    const res = await fetch(`${API_BASE}/properties`,{
      method:"POST",
      headers:{
        "Authorization": `Bearer ${at}`,
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body: JSON.stringify(payload)
    });
    if(!res.ok){ const txt=await res.text(); throw new Error(`POST /properties failed: ${res.status} ${txt}`); }
    return res.json();
  },
  async updateProperty(id, payload){
    const at = window.auth.getAccessToken();
    if(!at) throw new Error("Not authenticated");
    const res = await fetch(`${API_BASE}/properties/${encodeURIComponent(id)}`,{
      method:"PUT",
      headers:{
        "Authorization": `Bearer ${at}`,
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body: JSON.stringify(payload)
    });
    if(!res.ok){ const txt=await res.text(); throw new Error(`PUT /properties failed: ${res.status} ${txt}`); }
    return res.json();
  },
  async deleteProperty(id){
    const at = window.auth.getAccessToken();
    if(!at) throw new Error("Not authenticated");
    const res = await fetch(`${API_BASE}/properties/${encodeURIComponent(id)}`,{
      method:"DELETE",
      headers:{ "Authorization": `Bearer ${at}` }
    });
    if(!res.ok){ const txt=await res.text(); throw new Error(`DELETE /properties failed: ${res.status} ${txt}`); }
    return { ok:true };
  }
};
window.api = api;
