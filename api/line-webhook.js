export default async function handler(req, res) {
  // LINE Verify / Webhook 都要直接回 200
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const body = req.body;
    const events = body?.events || [];

    // LINE Verify 有時 events 會是空陣列
    if (events.length === 0) {
      return res.status(200).send("OK");
    }

    const event = events[0];

    if (
      !event ||
      !event.message ||
      event.message.type !== "text"
    ) {
      return res.status(200).send("OK");
    }

    const userMessage = event.message.text.trim();
    const replyToken = event.replyToken;

    // =========================
    // 企業公司簡介
    // =========================
    if (userMessage === "查看公司簡介(企業專屬)") {
      await replyToLine(replyToken, [
        {
          type: "text",
          text:
            "突破傳統派遣，\n" +
            "讓企業用人更彈性、更安心！\n\n" +
            "首創【時數包營運模組】，\n" +
            "把沉重的人力固定開銷，\n" +
            "變成精準可掌控的「預算制」！"
        },
        {
          type: "image",
          originalContentUrl:
            "https://relax93366453-svg.github.io/doclick.tw/%E5%85%AC%E5%8F%B8%E7%B0%A1%E4%BB%8B%E5%9C%96.jpg",
          previewImageUrl:
            "https://relax93366453-svg.github.io/doclick.tw/%E5%85%AC%E5%8F%B8%E7%B0%A1%E4%BB%8B%E5%9C%96.jpg"
        },
        {
          type: "text",
          text:
            "🌐 前往官方網站：\n" +
            "https://relax93366453-svg.github.io/doclick.tw/"
        }
      ]);

      return res.status(200).send("OK");
    }

    // =========================
    // 企業需求表單
    // =========================
    if (
      userMessage === "企業需求表單" ||
      userMessage === "填寫企業表單" ||
      userMessage === "需求表單" ||
      userMessage === "企業表單"
    ) {
      await replyToLine(replyToken, [
        {
          type: "text",
          text:
            "🏢 您好！歡迎使用愜易居企業派遣需求系統。\n\n" +
            "請留下您的派遣需求，我們將由專人立即與您聯繫：\n" +
            "https://forms.gle/q8EwvqCc5tqneWH26"
        }
      ]);

      return res.status(200).send("OK");
    }

    // =========================
    // 特色重點
    // =========================
    if (
      userMessage === "查看服務亮點" ||
      userMessage === "特色重點"
    ) {
      await replyToLine(replyToken, [
        {
          type: "text",
          text:
            "✨ 愜易居核心亮點：\n\n" +
            "・彈性派遣配置\n" +
            "・降低人事成本\n" +
            "・依企業需求彈性調配人力\n" +
            "・專業團隊管理\n" +
            "・降低固定開銷與用人風險"
        }
      ]);

      return res.status(200).send("OK");
    }

    return res.status(200).send("OK");

  } catch (error) {
    console.error(error);

    // 即使程式出錯，也先回 LINE 200
    return res.status(200).send("OK");
  }
}


async function replyToLine(replyToken, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN 尚未設定");
  }

  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        replyToken,
        messages
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `LINE API Error ${response.status}: ${text}`
    );
  }
}