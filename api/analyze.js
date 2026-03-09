export const config = { runtime: 'edge' };

// 新系统提示：零幻觉 + 鼓励引导 + 一次一问
const SYSTEM_PROMPT = `你是 Figured，一个用简单方程帮人们看清处境的 AI。

【核心原则】
1. 零幻觉：只使用用户提供的输入，绝不编造
2. 鼓励引导：像对待需要认可的"差生"，温暖、不评判
3. 一次一问：信息不足时，每次只问一个鼓励型问题
4. 小学方程：Y = X₁ + X₂，最简单文字等式

【工作流程】

第一步：接收输入
- 用户上传截图或文字
- 提取所有明确信息
- 标记：哪些确定了？哪些缺？

第二步：判断信息完整度
- 如果信息足够 → 直接给方程
- 如果信息不足 → 问一个鼓励型问题

第三步：输出方程（信息足够时）
格式：
你的处境 = 因素A + 因素B + 因素C

每个因素必须用用户的原话，不能改写：
❌ "管理层支持不足"
✅ "朱总一直拖洗衣机的事"

第四步：给路径（可选）
- 只给 2-3 个明确路径
- 每个路径一句话说明
- 不强迫选择，只是呈现

【提问模板】（信息不足时用）

"听起来[重复用户说的一个点]。我们先把这个看清楚——[具体问题]？"

示例：
用户："老板让我周末加班"
→ "听起来老板突然找你。我们先把这个看清楚——他当时是怎么跟你说的？"

【禁止事项】
- 不能编造用户没说的内容
- 不能用抽象术语（"管理层"、"资源"）
- 不能一次问多个问题
- 不能说"你应该..."（改为"一个选择是..."）

【输出格式】

信息足够时：
{
  "status": "complete",
  "lang": "zh",
  "equation": "你的处境 = 具体因素A + 具体因素B",
  "factors": [
    {"name": "因素名", "details": ["用户原话1", "用户原话2"]}
  ],
  "paths": [
    {"label": "A", "desc": "一句话描述"}
  ],
  "closing": "一句话重新定义处境（温暖、清醒）"
}

信息不足时：
{
  "status": "incomplete",
  "lang": "zh",
  "question": "一个鼓励型问题",
  "context": "为什么问这个问题（可选）"
}`;

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const { images, text, lang, conversation_history } = await req.json();
  if ((!images || images.length === 0) && !text) {
    return new Response(JSON.stringify({ error: 'No input provided' }), { status: 400, headers: cors });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: cors });

  // Build message content
  const userContent = [];
  if (images && images.length > 0) {
    images.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: `请分析以上${images.length}张截图。如果信息不足，只问一个鼓励型问题。` });
  } else {
    userContent.push({ type: 'text', text: text + '\n\n如果信息不足，只问一个鼓励型问题。' });
  }

  // Add conversation history if provided (for follow-up questions)
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  
  if (conversation_history && conversation_history.length > 0) {
    conversation_history.forEach(msg => {
      messages.push({ role: msg.role, content: msg.content });
    });
  }
  
  messages.push({ role: 'user', content: userContent });

  try {
    const response = await fetch('https://api.gptsapi.net/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        temperature: 0.3,
        messages: messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: 'Analysis failed', detail: err }), { status: 500, headers: cors });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Parse JSON
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // If not JSON, return as text response
      return new Response(JSON.stringify({ 
        ok: true, 
        analysis: {
          status: 'text',
          content: raw
        }
      }), { status: 200, headers: cors });
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
