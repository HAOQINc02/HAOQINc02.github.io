(function () {
  'use strict';
  const origin = 'https://openrouter.ai/api/v1';
  let panel = null;

  function money(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('接口返回的数据不完整');
    return '$' + value.toFixed(4);
  }

  async function request(path, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(origin + path, {
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        cache: 'no-store', redirect: 'error', signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw new Error('密钥无效或没有查询权限');
      if (!response.ok) throw new Error('查询失败（' + response.status + '），请稍后重试');
      const payload = await response.json();
      if (!payload || !payload.data || typeof payload.data !== 'object') throw new Error('接口返回的数据不完整');
      return payload.data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('网络连接失败，请稍后重试');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function showKeyUsage(target) {
    let host;
    try { host = new URL(localStorage.getItem('apiUrl') || origin).hostname; } catch { host = ''; }
    const key = localStorage.getItem('apiKey');
    if (host !== 'openrouter.ai') { target.textContent = '当前聊天接口不是 OpenRouter，无法查询此密钥用量。'; return; }
    if (!key) { target.textContent = '请先在设置中填写 OpenRouter 聊天密钥。'; return; }
    target.textContent = '正在查询…';
    try {
      const data = await request('/key', key);
      let result = '此密钥已用 ' + money(data.usage);
      result += data.limit_remaining == null ? '；未设置密钥限额。' : '；密钥剩余额度 ' + money(data.limit_remaining) + '。';
      target.textContent = result + '密钥额度不等于账户余额。';
    } catch (error) { target.textContent = error.message || '查询失败，请稍后重试。'; }
  }

  function openPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'lt-balance-overlay';
    panel.innerHTML = '<section class="lt-balance-sheet" role="dialog" aria-modal="true" aria-labelledby="lt-balance-title">' +
      '<header class="lt-balance-header"><strong id="lt-balance-title">OpenRouter 余额</strong><button class="lt-balance-close" type="button" aria-label="关闭">×</button></header>' +
      '<div class="lt-balance-body"><div class="lt-balance-caption">账户余额</div><div class="lt-balance-amount" aria-live="polite">尚未查询</div>' +
      '<p>余额配置加密保存在现有云同步中。电脑和手机首次各用相同密码解锁一次，以后打开即可自动刷新。账户余额需要 OpenRouter 管理密钥；普通聊天密钥只能查用量。</p>' +
      '<div class="lt-balance-key-wrap"><label for="lt-balance-key">OpenRouter 管理密钥</label><input id="lt-balance-key" type="password" autocomplete="off" spellcheck="false" placeholder="留空尝试当前 API 密钥"></div>' +
      '<div class="lt-balance-password-wrap"><label for="lt-balance-password">解锁密码（至少 8 位）</label><input id="lt-balance-password" type="password" autocomplete="off" spellcheck="false" placeholder="电脑和手机使用相同密码"></div>' +
      '<div class="lt-balance-key-status" aria-live="polite"></div><button class="lt-balance-query" type="button">保存并刷新余额</button><button class="lt-balance-reconfigure" type="button">更换管理密钥</button><button class="lt-balance-forget" type="button">删除云端余额配置</button><p class="lt-balance-help"><a href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">直接打开 OpenRouter 余额页</a> · <a href="https://openrouter.ai/settings/management-keys" target="_blank" rel="noopener noreferrer">获取管理密钥</a></p>' +
      '<div class="lt-balance-divider"></div><div class="lt-balance-caption">当前聊天密钥用量</div><div class="lt-balance-usage" aria-live="polite">正在查询…</div>' +
      '<button class="lt-balance-refresh" type="button">刷新密钥用量</button></div></section>';
    const element = panel;
    const amount = element.querySelector('.lt-balance-amount');
    const input = element.querySelector('#lt-balance-key');
    const password = element.querySelector('#lt-balance-password');
    const keyWrap = element.querySelector('.lt-balance-key-wrap');
    const passwordWrap = element.querySelector('.lt-balance-password-wrap');
    const usage = element.querySelector('.lt-balance-usage');
    const button = element.querySelector('.lt-balance-query');
    const keyStatus = element.querySelector('.lt-balance-key-status');
    const forget = element.querySelector('.lt-balance-forget');
    const reconfigure = element.querySelector('.lt-balance-reconfigure');
    const vault = window.ltBalanceVault;
    let generation = 0, busy = false, replacing = false, previousUnlocked = false;
    function render() {
      const state = vault.status(), setup = replacing || !state.configured;
      keyWrap.hidden = !setup;
      passwordWrap.hidden = state.unlocked && !replacing;
      keyStatus.textContent = setup ? (state.connected ? '设置后加密保存到云端。' : (state.error || '等待云同步连接…')) : state.unlocked ? '已在本设备解锁，打开时会自动刷新。' : '已收到云端配置，请输入解锁密码。';
      button.textContent = setup ? '保存并刷新余额' : state.unlocked ? '刷新余额' : '解锁并刷新余额';
      forget.hidden = !state.configured;
      reconfigure.hidden = !state.configured || replacing;
    }
    function close() { generation++; input.value = ''; password.value = ''; window.removeEventListener('lt-balance-vault-changed', onVaultChanged); element.remove(); if (panel === element) panel = null; }
    element.querySelector('.lt-balance-close').addEventListener('click', close);
    element.addEventListener('click', event => { if (event.target === element) close(); });
    element.querySelector('.lt-balance-refresh').addEventListener('click', () => showKeyUsage(usage));
    async function refresh() {
      if (busy) return;
      const state = vault.status(), secret = password.value;
      const setup = replacing || !state.configured;
      let manager = input.value.trim();
      if (setup && !manager) {
        try { if (new URL(localStorage.getItem('apiUrl') || origin).hostname === 'openrouter.ai') manager = localStorage.getItem('apiKey') || ''; } catch { /* no matching provider */ }
      }
      if (setup && !manager) { amount.textContent = '请填写管理密钥'; return; }
      if ((setup || !state.unlocked) && !secret) { amount.textContent = '请填写解锁密码'; return; }
      input.value = ''; password.value = '';
      const current = ++generation;
      busy = true; button.disabled = true; amount.textContent = '正在查询…';
      try {
        const balance = setup ? await vault.save(manager, secret) : state.unlocked ? await vault.refresh() : await vault.unlock(secret);
        if (current !== generation) return;
        replacing = false; previousUnlocked = true; amount.textContent = money(balance); render();
      } catch (error) { if (current === generation) amount.textContent = error.message || '查询失败，请稍后重试'; }
      finally { busy = false; if (current === generation) button.disabled = false; }
    }
    button.addEventListener('click', refresh);
    reconfigure.addEventListener('click', () => { replacing = true; render(); });
    forget.addEventListener('click', async () => {
      if (!window.confirm('删除云端余额配置？电脑和手机都将需要重新设置。')) return;
      generation++; button.disabled = true;
      try { await vault.remove(); replacing = false; previousUnlocked = false; amount.textContent = '尚未查询'; render(); }
      catch (error) { amount.textContent = error.message || '删除失败'; }
      finally { button.disabled = false; }
    });
    function onVaultChanged() {
      if (panel !== element) return;
      const state = vault.status(); render();
      if (!state.unlocked && previousUnlocked) { previousUnlocked = false; amount.textContent = state.configured ? '请先解锁余额配置' : '尚未查询'; }
      if (state.unlocked && !previousUnlocked && !busy) { previousUnlocked = true; refresh(); }
    }
    window.addEventListener('lt-balance-vault-changed', onVaultChanged);
    document.body.appendChild(element);
    render();
    showKeyUsage(usage);
    vault.ready.then(onVaultChanged);
  }

  function install() {
    const page = document.querySelector('.settings-page');
    if (!page) { if (panel) { panel.remove(); panel = null; } return; }
    if (page.querySelector('#lt-balance-entry')) return;
    const label = Array.from(page.querySelectorAll('.section-label')).find(el => el.textContent.includes('文字对话模型配置'));
    if (!label) return;
    const entry = document.createElement('button');
    entry.id = 'lt-balance-entry'; entry.type = 'button'; entry.className = 'lt-balance-entry';
    entry.innerHTML = '<span class="lt-balance-icon">💰</span><span class="lt-balance-info"><strong>OpenRouter 余额与用量</strong><small>查看账户余额和聊天密钥用量</small></span><span class="lt-balance-arrow">›</span>';
    entry.addEventListener('click', openPanel);
    label.insertAdjacentElement('afterend', entry);
  }
  new MutationObserver(install).observe(document.getElementById('app'), { childList: true, subtree: true });
  install();
}());
