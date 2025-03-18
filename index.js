const express = require("express");
const axios = require("axios");
const qs = require("querystring");
const dotenv = require("dotenv").config();
const cheerio = require("cheerio");

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/zoho/oauth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Authorization code not provided" });
  }
  try {
    const response = await axios.post(
      "https://accounts.zoho.com/oauth/v2/token",
      qs.stringify({
        code,
        grant_type: "authorization_code",
        client_id: process.env.ZOHO_MAIL_CLIENT_ID,
        client_secret: process.env.ZOHO_MAIL_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_MAIL_REDIRECT_URI,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    res.json({
      message: "OAuth successful",
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || "OAuth Error" });
  }
});

// app.get("/oauth/refresh", async (req, res) => {
//   const { refreshToken } = req.body;
//   if (!refreshToken) {
//     return res.status(400).json({ error: "No refresh token provided" });
//   }
//   try {
//

//     res.json({
//       message: "Token refreshed",
//       accessToken: response.data.access_token,
//     });
//   } catch (error) {
//     res
//       .status(500)
//       .json({ error: error.response?.data || "Token Refresh Error" });
//   }
// });

// Send Email Route

async function refreshZohoMailToken(refreshToken) {
  try {
    const response = await axios.post(
      "https://accounts.zoho.com/oauth/v2/token",
      qs.stringify({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        client_id: process.env.ZOHO_MAIL_CLIENT_ID,
        client_secret: process.env.ZOHO_MAIL_CLIENT_SECRET,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error("Error in refreshing token", error.message);
    return "";
  }
}

app.post("/zoho/send-email", async (req, res) => {
  try {
    const { refreshToken, fromAddress, toAddress, subject, content } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Access token not provided" });
    }

    const accessToken = await refreshZohoMailToken(refreshToken);

    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: "https://mail.zoho.com/api/accounts",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    };

    const requestToZoho = await axios.request(config);
    const datafromZoho = requestToZoho.data.data[0];
    const accountid = datafromZoho.accountId;
    console.log(accountid);

    const response = await axios.post(
      `https://mail.zoho.com/api/accounts/${accountid}/messages`,
      {
        fromAddress,
        toAddress,
        subject,
        content,
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
      }
    );
    res.status(200).json(response.data);
  } catch (error) {
    console.error(error.message);
    res
      .status(error.response?.status || 500)
      .json({ error: error.response?.data || "Internal Server Error" });
  }
});

app.post("/zoho/list-emails", async (req, res) => {
  try {
    const { refreshToken, status } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Access token not provided" });
    }
    const accessToken = await refreshZohoMailToken(refreshToken);
    let config1 = {
      method: "get",
      maxBodyLength: Infinity,
      url: "https://mail.zoho.com/api/accounts",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    };

    const requestToZoho = await axios.request(config1);
    const datafromZoho = requestToZoho.data.data[0];
    const accountid = datafromZoho.accountId;
    console.log(accountid);

    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: `https://mail.zoho.com/api/accounts/${accountid}/messages/view?limit=20&status=${status}`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    };

    const data = await axios.request(config);
    console.log(data.data.data);

    const requiredfields = data.data?.data.map((email) => ({
      sender: email.sender,
      fromAddress: email.fromAddress,
      subject: email.subject,
      summary: email.summary,
    }));
    return res.status(200).json({ data: requiredfields });
  } catch (error) {
    console.error(error.message);
    res
      .status(error.response?.status || 500)
      .json({ error: error.response?.data || "Internal Server Error" });
  }
});

app.post("/zoho/get-mail-content", async (req, res) => {
  try {
    const zohoAPI = axios.create({
      baseURL: "https://mail.zoho.com/api",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
    });

    function extractReadableText(html) {
      const $ = cheerio.load(html);
      $("meta, style, script, img, link").remove();
      let text = $("body").text();
      text = text.replace(/\s+/g, " ").trim();
      return text;
    }

    const { refreshToken, status } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token not provided" });
    }

    const accessToken = await refreshZohoMailToken(refreshToken);
    zohoAPI.defaults.headers[
      "Authorization"
    ] = `Zoho-oauthtoken ${accessToken}`;

    const accountResponse = await zohoAPI.get("/accounts");
    const accountData = accountResponse.data?.data?.[0];

    if (!accountData)
      return res.status(400).json({ error: "No Zoho mail account found" });

    const accountId = accountData.accountId;
    console.log("Account ID:", accountId);

    const messagesResponse = await zohoAPI.get(
      `/accounts/${accountId}/messages/view?limit=5&status=${status}`
    );
    const emailsData = messagesResponse.data?.data;

    if (!emailsData || emailsData.length === 0) {
      return res
        .status(200)
        .json({ message: "No unread emails found", data: [] });
    }

    const emailRequests = emailsData.map((email) => ({
      messageId: email.messageId,
      folderId: email.folderId,
      sender: email.sender,
      fromAddress: email.fromAddress,
      subject: email.subject,
    }));

    const emailContents = await Promise.allSettled(
      emailRequests.map(async (email) => {
        try {
          const contentResponse = await zohoAPI.get(
            `/accounts/${accountId}/folders/${email.folderId}/messages/${email.messageId}/content`
          );
          return {
            mailContent: extractReadableText(contentResponse.data.data.content),
            sender: email.sender,
            fromAddress: email.fromAddress,
            subject: email.subject,
          };
        } catch (error) {
          console.error(
            `Error fetching content for messageId: ${email.messageId}`,
            error.message
          );
          return {
            mailContent: "Error fetching email content",
            sender: email.sender,
            fromAddress: email.fromAddress,
            subject: email.subject,
          };
        }
      })
    );

    const emails = emailContents
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    return res.status(200).json({ data: emails });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(error.response?.status || 500)
      .json({ error: error.response?.data || "Internal Server Error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
