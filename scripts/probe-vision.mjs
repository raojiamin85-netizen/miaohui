// 探测：云服务模型是否支持图片输入、哪种消息格式能跑通
// 用法：node probe-vision.mjs
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;

const URL = 'https://miaohui-reply.app.workbuddy.host/';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  const out = { attempts: [] };
  const cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PC.endpoint,
    publishableKey: PC.publishableKey,
  });

  const models = await cloud.llm.models.list();
  out.models = models.map((m) => ({
    id: m.id,
    name: m.name,
    supportsImages: m.supportsImages,
    disabledMultimodal: m.disabledMultimodal,
    disabled: m.disabled,
  }));

  const model = models.find((m) => m.disabled !== true);
  if (!model) { out.fatal = 'no model'; return out; }
  out.picked = model.id;

  // 造一张"聊天截图"：白底黑字
  const c = document.createElement('canvas');
  c.width = 360; c.height = 150;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 360, 150);
  ctx.fillStyle = '#111111'; ctx.font = '22px sans-serif';
  ctx.fillText('在吗？明天有空吗', 20, 55);
  ctx.fillText('想约你吃个饭', 20, 100);
  const dataUrl = c.toDataURL('image/png');

  const sys = { role: 'system', content: '你是 OCR 助手，只输出识别到的文字，一行一条，不要任何解释。' };
  const shapes = [
    ['A: image_url + {url}', [{ type: 'text', text: '识别这张聊天截图的文字' }, { type: 'image_url', image_url: { url: dataUrl } }]],
    ['B: image_url 字符串', [{ type: 'text', text: '识别这张聊天截图的文字' }, { type: 'image_url', image_url: dataUrl }]],
    ['C: image + {url}', [{ type: 'text', text: '识别这张聊天截图的文字' }, { type: 'image', image: { url: dataUrl } }]],
    ['D: input_image', [{ type: 'text', text: '识别这张聊天截图的文字' }, { type: 'input_image', image_url: dataUrl }]],
  ];

  for (const [label, content] of shapes) {
    const rec = { label, text: '', error: '' };
    try {
      for await (const chunk of cloud.llm.chat.completions.create({
        model: model.id,
        messages: [sys, { role: 'user', content }],
        stream: true,
        temperature: 0.1,
      })) {
        const d = chunk.choices[0]?.delta;
        if (d?.content) rec.text += d.content;
      }
    } catch (e) {
      rec.error = ((e && e.error && e.error.code) || (e && e.name) || '') + ' | ' + (e && e.message || String(e));
    }
    out.attempts.push(rec);
    if (rec.text && rec.text.trim()) break;
  }

  // 顺带测：纯文本调用是否正常（作为对照）
  let plain = '';
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: model.id,
      messages: [{ role: 'system', content: '只回一个字。' }, { role: 'user', content: '回：好' }],
      stream: true,
      temperature: 0.1,
    })) {
      const d = chunk.choices[0]?.delta;
      if (d?.content) plain += d.content;
    }
  } catch (e) {
    plain = 'ERR ' + ((e && e.error && e.error.code) || e.message);
  }
  out.plainControl = plain;
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
