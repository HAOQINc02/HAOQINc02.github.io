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
      '<p>查询账户余额需要 OpenRouter 管理密钥。密钥权限较高，仅在本次查询中使用，不保存到酒馆或云同步。也可以直接打开 OpenRouter 查看余额。</p>' +
      '<label for="lt-balance-key">管理密钥</label><input id="lt-balance-key" type="password" autocomplete="off" spellcheck="false" placeholder="填写 OpenRouter 管理密钥">' +
      '<button class="lt-balance-query" type="button">查询账户余额</button><p class="lt-balance-help"><a href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">直接打开 OpenRouter 余额页</a> · <a href="https://openrouter.ai/settings/management-keys" target="_blank" rel="noopener noreferrer">获取管理密钥</a></p>' +
      '<div class="lt-balance-divider"></div><div class="lt-balance-caption">当前聊天密钥用量</div><div class="lt-balance-usage" aria-live="polite">正在查询…</div>' +
      '<button class="lt-balance-refresh" type="button">刷新密钥用量</button></div></section>';
    const element = panel;
    const amount = element.querySelector('.lt-balance-amount');
    const input = element.querySelector('#lt-balance-key');
    const usage = element.querySelector('.lt-balance-usage');
    const button = element.querySelector('.lt-balance-query');
    function close() { input.value = ''; element.remove(); if (panel === element) panel = null; }
    element.querySelector('.lt-balance-close').addEventListener('click', close);
    element.addEventListener('click', event => { if (event.target === element) close(); });
    element.querySelector('.lt-balance-refresh').addEventListener('click', () => showKeyUsage(usage));
    button.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) { amount.textContent = '请填写管理密钥'; return; }
      input.value = '';
      button.disabled = true; amount.textContent = '正在查询…';
      try {
        const data = await request('/credits', key);
        if (typeof data.total_credits !== 'number' || typeof data.total_usage !== 'number') throw new Error('接口返回的数据不完整');
        amount.textContent = money(data.total_credits - data.total_usage);
      } catch (error) { amount.textContent = error.message || '查询失败，请稍后重试'; }
      finally { button.disabled = false; }
    });
    document.body.appendChild(element);
    showKeyUsage(usage);
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
