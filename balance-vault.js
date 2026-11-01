(function () {
  'use strict';
  // Reuse only the active Gist connection, keeping this encrypted file separate from chat snapshots.
  const originalFetch = window.fetch.bind(window);
  const filename = 'light_tavern_balance_vault_v1.json';
  const databaseName = 'light-tavern-balance-vault';
  let connection = null, record = null, recordGistId = '', unlockedKey = null, revision = 0, scanned = false, cloudError = '';
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const changed = () => window.dispatchEvent(new CustomEvent('lt-balance-vault-changed'));
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const valid = obj => obj && obj.version === 1 && typeof obj.salt === 'string' && typeof obj.iv === 'string' && typeof obj.data === 'string' && obj.salt.length < 64 && obj.iv.length < 64 && obj.data.length < 8192;
  function storeDb(value) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('vault');
      open.onerror = () => reject(open.error || Error('本机保存失败'));
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('vault', 'readwrite');
        tx.objectStore('vault').put(value, 'state');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('本机保存失败')); };
      };
    });
  }
  function readDb() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('vault');
      open.onerror = () => reject(open.error || Error('本机读取失败'));
      open.onsuccess = () => {
        const db = open.result, req = db.transaction('vault').objectStore('vault').get('state');
        req.onsuccess = () => { const value = req.result; db.close(); resolve(value); };
        req.onerror = () => { db.close(); reject(req.error || Error('本机读取失败')); };
      };
    });
  }
  const ready = readDb().then(value => {
    if (value && valid(value.record) && typeof value.gistId === 'string') { record = value.record; recordGistId = value.gistId; unlockedKey = value.key || null; changed(); }
  }).catch(() => {});
  async function derive(password, salt) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: 210000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function decrypt(envelope, key) {
    try { return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.data))); }
    catch { throw Error('解锁密码不正确，或云端配置已损坏'); }
  }
  async function ingest(gist, atRevision, sourceId) {
    await ready;
    if (atRevision !== revision || sourceId !== (localStorage.getItem('lt_cloud_gist_id') || '') || !connection || connection.id !== sourceId) return;
    const file = gist && gist.files && gist.files[filename];
    if (!gist || !gist.files || typeof gist.files !== 'object' || gist.truncated || Object.keys(gist.files).length >= 300) { cloudError = '云端配置列表不完整，暂不能保存'; changed(); return; }
    if (!file) { scanned = true; cloudError = ''; changed(); return; }
    if (file.truncated || typeof file.content !== 'string') { cloudError = '云端余额配置不完整'; changed(); return; }
    let incoming; try { incoming = JSON.parse(file.content); } catch { cloudError = '云端余额配置无法读取'; changed(); return; }
    if (atRevision !== revision) return;
    if (incoming && incoming.version === 1 && incoming.deleted === true) {
      record = null; recordGistId = ''; unlockedKey = null; scanned = true; cloudError = ''; await storeDb(null); changed(); return;
    }
    if (!valid(incoming)) { cloudError = '云端余额配置格式不正确'; changed(); return; }
    const gistId = sourceId;
    if (!gistId || gistId !== (localStorage.getItem('lt_cloud_gist_id') || '')) return;
    if (recordGistId !== gistId || (record && incoming.salt !== record.salt)) unlockedKey = null;
    record = incoming; recordGistId = gistId; scanned = true; cloudError = '';
    await storeDb({ record, gistId: recordGistId, key: unlockedKey });
    changed();
  }
  // Observe the same authenticated Gist request the app already makes; never persist or display its token.
  window.fetch = async function (input, init) {
    let url, auth;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      auth = headers.get('authorization');
    } catch { return originalFetch(input, init); }
    const id = localStorage.getItem('lt_cloud_gist_id') || '';
    const isGist = url.protocol === 'https:' && url.hostname === 'api.github.com' && /^[a-f0-9]{5,64}$/i.test(id) && url.pathname === '/gists/' + id && auth && /^(Bearer|token)\s/i.test(auth);
    if (isGist) {
      if (!connection || connection.id !== id) { scanned = false; cloudError = ''; }
      connection = { id, authorization: auth }; changed();
    }
    const atRevision = revision;
    const response = await originalFetch(input, init);
    const method = String((init && init.method) || (input instanceof Request && input.method) || 'GET').toUpperCase();
    if (isGist && method === 'GET' && response.ok) response.clone().json().then(body => ingest(body, atRevision, id)).catch(() => {});
    return response;
  };
  async function remoteWrite(envelope) {
    const id = localStorage.getItem('lt_cloud_gist_id') || '';
    if (!connection || connection.id !== id || !scanned || cloudError) throw Error(cloudError || '等待云同步连接，请稍后再试');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await originalFetch('https://api.github.com/gists/' + id, {
        method: 'PATCH', headers: { Authorization: connection.authorization, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(envelope || { version: 1, deleted: true }) } } }),
        redirect: 'error', signal: ctrl.signal
      });
      if (!res.ok) throw Error('云端保存失败（' + res.status + '），请检查云同步连接');
    } catch (e) { if (e.name === 'AbortError' || e instanceof TypeError) throw Error('云端连接失败，请稍后重试'); throw e; }
    finally { clearTimeout(timer); }
  }
  async function getCredits(key) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await originalFetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) throw Error('管理密钥无效或没有查询权限');
      if (!res.ok) throw Error('查询余额失败（' + res.status + '）');
      const payload = await res.json(), data = payload && payload.data;
      if (!data || typeof data.total_credits !== 'number' || typeof data.total_usage !== 'number') throw Error('余额数据不完整');
      return data.total_credits - data.total_usage;
    } catch (e) { if (e.name === 'AbortError' || e instanceof TypeError) throw Error('网络连接失败，请稍后重试'); throw e; }
    finally { clearTimeout(timer); }
  }
  window.ltBalanceVault = {
    ready,
    status: () => { const id = localStorage.getItem('lt_cloud_gist_id') || ''; const configured = !!record && recordGistId === id; return { configured, unlocked: !!(configured && unlockedKey), connected: !!connection && connection.id === id && scanned && !cloudError, error: cloudError }; },
    save: async (managementKey, password) => {
      if (!managementKey) throw Error('请填写 OpenRouter 管理密钥');
      if (password.length < 8) throw Error('解锁密码至少需要 8 个字符');
      const credits = await getCredits(managementKey);
      const salt = b64(crypto.getRandomValues(new Uint8Array(16))), iv = b64(crypto.getRandomValues(new Uint8Array(12)));
      const key = await derive(password, salt);
      const data = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, encoder.encode(managementKey)));
      const envelope = { version: 1, salt, iv, data };
      revision++; await remoteWrite(envelope);
      record = envelope; recordGistId = connection.id; unlockedKey = key; await storeDb({ record, gistId: recordGistId, key }); changed();
      return credits;
    },
    unlock: async password => {
      await ready;
      if (!record || recordGistId !== (localStorage.getItem('lt_cloud_gist_id') || '')) throw Error('尚未收到云端余额配置，请等待云同步');
      const key = await derive(password, record.salt), managementKey = await decrypt(record, key);
      const credits = await getCredits(managementKey);
      unlockedKey = key; await storeDb({ record, gistId: recordGistId, key }); changed(); return credits;
    },
    refresh: async () => {
      await ready;
      if (!record || !unlockedKey || recordGistId !== (localStorage.getItem('lt_cloud_gist_id') || '')) throw Error('请先在本设备解锁余额配置');
      return getCredits(await decrypt(record, unlockedKey));
    },
    remove: async () => {
      revision++; await remoteWrite(null); record = null; recordGistId = ''; unlockedKey = null;
      await storeDb(null); changed();
    }
  };
}());
