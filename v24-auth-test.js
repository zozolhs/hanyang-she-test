// V24 authentication-only QA frontend. No legacy Supabase Auth or data/RLS calls.
// The opaque test session is intentionally memory-only, never in storage or URLs.
(() => {
  "use strict";
  const API = "https://ahmqthuympannqsrszvv.supabase.co/functions/v1/she-v24-auth";
  const MODULES = ["safety", "health", "roster", "education"];
  const LABELS = { safety:"안전", health:"보건", roster:"인원", education:"교육" };
  let token = null;
  let current = null;
  let registerMode = false;
  let busy = false;
  const $ = (id) => document.getElementById(id);
  const message = (text, kind="") => {
    $("message").textContent = text;
    $("message").dataset.kind = kind;
  };
  async function call(action, data={}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    let response;
    try {
      response = await fetch(API, {
        method: "POST", headers, cache: "no-store", credentials:"omit",
        body: JSON.stringify({ action, ...data }),
      });
    } catch {
      throw new Error("인증 서버에 연결할 수 없습니다. 네트워크와 TEST 배포 상태를 확인하세요.");
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error("서버 응답 형식이 올바르지 않습니다."); }
    if (!response.ok) {
      throw new Error(String(result.error || "인증 요청 실패").slice(0, 200));
    }
    return result;
  }
  function modeChange(isRegister) {
    registerMode = isRegister;
    $("tabLogin").setAttribute("aria-selected", String(!isRegister));
    $("tabRegister").setAttribute("aria-selected", String(isRegister));
    $("registerFields").hidden = !isRegister;
    $("displayName").required = isRegister;
    $("submit").textContent = isRegister ? "가입 승인 신청" : "로그인";
    $("password").autocomplete = isRegister ? "new-password" : "current-password";
    $("password").value = "";
    message("");
  }
  function signedIn(account) {
    current = account;
    $("guest").hidden = !!account;
    $("signedIn").hidden = !account;
    $("admin").hidden = account?.role !== "super_admin";
    $("usersList").replaceChildren();
    $("userInfo").textContent = account
      ? account.name + " / " + account.login_id + " / " +
        account.role + " / " + account.status
      : "";
    if (!account) {
      token = null;
      $("password").value = "";
    }
  }
  async function onAuth(event) {
    event.preventDefault();
    if (busy) return;
    const login_id = $("loginId").value.trim();
    const password = $("password").value;
    if (!/^[a-z0-9][a-z0-9._-]{3,31}$/.test(login_id)) return message("아이디 형식을 확인하세요.", "error");
    if ([...password].length < 6 || [...password].length > 128) return message("비밀번호는 6~128자리여야 합니다.", "error");
    busy = true;
    $("submit").disabled = true;
    try {
      if (registerMode) {
        const data = await call("register", {
          login_id, password,
          display_name: $("displayName").value.trim(),
          department: $("department").value.trim(),
        });
        $("password").value = "";
        message(data.message || "가입 승인 신청 완료", "ok");
      } else {
        const data = await call("login", { login_id, password });
        $("password").value = "";
        if (!data.token || data.account?.status !== "approved") throw new Error("승인된 계정을 확인할 수 없습니다.");
        token = data.token;
        signedIn(data.account);
        message("로그인 성공. 인증 세션을 발급받았습니다.", "ok");
      }
    } catch (error) {
      $("password").value = "";
      message(error.message || "요청 실패", "error");
    } finally {
      busy = false;
      $("submit").disabled = false;
    }
  }
  async function doLogout() {
    try {
      await call("logout");
      message("로그아웃 완료", "ok");
    } catch (error) {
      message("서버 로그아웃 실패: " + error.message + ". 로컬 세션은 종료되었습니다.", "error");
    } finally {
      signedIn(null);
    }
  }
  function makeText(parent, tag, value, className="") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    parent.append(el);
    return el;
  }
  function selectField(parent, caption, choices, chosen) {
    const label = makeText(parent,"label",caption);
    const select = document.createElement("select");
    for (const [value, text] of choices) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      select.append(opt);
    }
    select.value = chosen;
    label.append(select);
    return select;
  }
  function userCard(user) {
    const card = document.createElement("div");
    card.className = "account";
    makeText(card, "div", user.login_id + " — " + user.display_name, "title");
    makeText(card, "div", (user.department || "소속 없음") + " · " + user.status + " · " + user.role, "meta");
    if (user.role === "super_admin") {
      makeText(card,"small","최고관리자 계정은 여기서 변경할 수 없습니다.");
      return card;
    }
    const controls = document.createElement("div");
    controls.className = "controls";
    const role = selectField(controls, "역할", [
      ["worker","일반 근로자"],["viewer_admin","조회 관리자"],["admin","관리자"]
    ], user.role);
    const status = selectField(controls, "계정 상태", [
      ["pending","승인 대기"],["approved","승인"],["blocked","차단"],["rejected","거절"]
    ], user.status);
    card.append(controls);
    const permissions = document.createElement("div");
    permissions.className = "controls";
    permissions.style.margin = "13px 0";
    const checks = {};
    for (const key of MODULES) {
      const label = document.createElement("label");
      label.className = "permission";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = user.permissions?.[key] === true;
      checks[key] = checkbox;
      label.append(checkbox, document.createTextNode(LABELS[key]));
      permissions.append(label);
    }
    card.append(permissions);
    const save = makeText(card, "button", "승인·권한 저장");
    save.type = "button";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const perms = Object.fromEntries(MODULES.map(key => [key, checks[key].checked]));
        await call("set_user", {
          account_id: user.id, role: role.value, status: status.value, permissions: perms
        });
        message(user.login_id + " 계정 승인·권한 변경 완료", "ok");
        await loadUsers();
      } catch(error) {
        message(error.message || "변경 실패", "error");
      } finally {
        save.disabled = false;
      }
    });
    return card;
  }
  async function loadUsers() {
    if (current?.role !== "super_admin") return;
    $("loadUsers").disabled = true;
    try {
      const data = await call("users");
      const list = $("usersList");
      list.replaceChildren();
      for (const user of data.users || []) list.append(userCard(user));
      if (!data.users?.length) makeText(list, "p", "등록된 계정이 없습니다.");
      message("회원 목록을 확인했습니다.", "ok");
    } catch(error) { message(error.message || "목록 조회 실패", "error"); }
    finally { $("loadUsers").disabled = false; }
  }
  $("tabLogin").addEventListener("click", () => modeChange(false));
  $("tabRegister").addEventListener("click", () => modeChange(true));
  $("authForm").addEventListener("submit", onAuth);
  $("logout").addEventListener("click", doLogout);
  $("refreshMe").addEventListener("click", async () => {
    try {
      const data = await call("me");
      signedIn(data.account);
      message("세션 유효성 확인 완료", "ok");
    } catch(error) {
      signedIn(null);
      message(error.message || "세션 만료", "error");
    }
  });
  $("loadUsers").addEventListener("click", loadUsers);
  modeChange(false);
})();