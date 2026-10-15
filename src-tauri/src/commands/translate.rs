use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiProvider {
    Deepl,
    Google,
    Bing,
    Lara,
    Baidu,
    Aliyun,
    Custom,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    pub from: String,
    pub to: String,
    pub api: ApiProvider,
    pub api_key: String,
    #[serde(default)]
    pub use_free_api: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslateResponse {
    pub translated_text: String,
    pub detected_language: Option<String>,
    pub alternatives: Vec<String>,
}

#[tauri::command]
pub async fn translate_text(request: TranslateRequest) -> Result<TranslateResponse, String> {
    let client = reqwest::Client::new();

    match request.api {
        ApiProvider::Deepl => Deepl::translate(&client, &request).await,
        ApiProvider::Google => Google::translate(&client, &request).await,
        ApiProvider::Bing => Bing::translate(&client, &request).await,
        ApiProvider::Lara => Lara::translate(&client, &request).await,
        ApiProvider::Baidu => Baidu::translate(&client, &request).await,
        ApiProvider::Aliyun => Aliyun::translate(&client, &request).await,
        ApiProvider::Custom => Custom::translate(&client, &request).await,
    }
}

#[tauri::command]
pub async fn validate_api_key(api: ApiProvider, api_key: String) -> Result<bool, String> {
    let client = reqwest::Client::new();

    match api {
        ApiProvider::Deepl => Deepl::validate(&client, &api_key).await,
        ApiProvider::Google => Google::validate(&client, &api_key).await,
        ApiProvider::Bing => Bing::validate(&client, &api_key).await,
        ApiProvider::Lara => Lara::validate(&client, &api_key).await,
        ApiProvider::Baidu => Baidu::validate(&client, &api_key).await,
        ApiProvider::Aliyun => Aliyun::validate(&client, &api_key).await,
        ApiProvider::Custom => Custom::validate(&client, &api_key).await,
    }
}

trait TranslationProvider {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String>;
    async fn validate(client: &reqwest::Client, api_key: &str) -> Result<bool, String>;
}

struct Deepl;
struct Google;
struct Bing;
struct Lara;
struct Baidu;
struct Aliyun;
struct Custom;

fn parse_custom_url(value: &str) -> Result<reqwest::Url, String> {
    let url =
        reqwest::Url::parse(value.trim()).map_err(|_| "Custom API URL is invalid".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Custom API URL must use http or https".to_string());
    }
    Ok(url)
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn hmac_sha1(key: &[u8], value: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha1>::new_from_slice(key).expect("HMAC-SHA1 accepts any key");
    mac.update(value);
    mac.finalize().into_bytes().to_vec()
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn parse_credential_pair<'a>(value: &'a str, provider: &str) -> Result<(&'a str, &'a str), String> {
    let mut parts = value.trim().splitn(2, ',').map(str::trim);
    let first = parts.next().unwrap_or("");
    let second = parts.next().unwrap_or("");
    if first.is_empty() || second.is_empty() {
        return Err(format!(
            "{provider} requires two credentials separated by a comma"
        ));
    }
    Ok((first, second))
}

fn baidu_language(value: &str) -> &str {
    match value {
        "ja" => "jp",
        "ko" => "kor",
        "zh-TW" => "cht",
        other => other,
    }
}

// deepl

#[derive(Deserialize)]
struct DeepLResponse {
    translations: Vec<DeepLTranslation>,
}

#[derive(Deserialize)]
struct DeepLTranslation {
    text: String,
    detected_source_language: Option<String>,
    #[serde(default)]
    alternatives: Vec<String>,
}

impl TranslationProvider for Deepl {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        let key = req.api_key.trim();
        let base_url = if key.ends_with(":fx") {
            "https://api-free.deepl.com/v2"
        } else {
            "https://api.deepl.com/v2"
        };

        let mut params = vec![
            ("text", req.text.clone()),
            ("target_lang", req.to.to_uppercase()),
        ];
        if req.from != "auto" {
            params.push(("source_lang", req.from.to_uppercase()));
        }

        let response = client
            .post(&format!("{}/translate", base_url))
            .header("Authorization", format!("DeepL-Auth-Key {}", key))
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("DeepL request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "DeepL API error ({}): {}",
                response.status(),
                response.text().await.unwrap_or_default()
            ));
        }

        let body: DeepLResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse DeepL response: {}", e))?;
        let translation = body
            .translations
            .first()
            .ok_or("No translation found in DeepL response")?;

        Ok(TranslateResponse {
            translated_text: translation.text.clone(),
            detected_language: translation
                .detected_source_language
                .as_ref()
                .map(|s| s.to_lowercase()),
            alternatives: translation.alternatives.clone(),
        })
    }

    async fn validate(client: &reqwest::Client, api_key: &str) -> Result<bool, String> {
        let key = api_key.trim();
        let base_url = if key.ends_with(":fx") {
            "https://api-free.deepl.com/v2"
        } else {
            "https://api.deepl.com/v2"
        };
        let response = client
            .get(&format!("{}/usage", base_url))
            .header("Authorization", format!("DeepL-Auth-Key {}", key))
            .send()
            .await
            .map_err(|e| format!("DeepL validation failed: {}", e))?;
        Ok(response.status().is_success())
    }
}

// google

#[derive(Deserialize)]
struct GoogleCloudResponse {
    data: GoogleCloudData,
}

#[derive(Deserialize)]
struct GoogleCloudData {
    translations: Vec<GoogleCloudTranslation>,
}

#[derive(Deserialize)]
struct GoogleCloudTranslation {
    #[serde(rename = "translatedText")]
    translated_text: String,
    #[serde(rename = "detectedSourceLanguage")]
    detected_source_language: Option<String>,
}

impl TranslationProvider for Google {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        if !req.api_key.trim().is_empty() {
            let mut payload = serde_json::json!({
                "q": req.text,
                "target": req.to,
                "format": "text",
            });
            if req.from != "auto" {
                payload["source"] = serde_json::json!(req.from);
            }

            let response = client
                .post("https://translation.googleapis.com/language/translate/v2")
                .query(&[("key", req.api_key.trim())])
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Google Cloud request failed: {}", e))?;

            let status = response.status();
            if !status.is_success() {
                return Err(format!(
                    "Google Cloud API error ({}): {}",
                    status,
                    response.text().await.unwrap_or_default()
                ));
            }

            let body: GoogleCloudResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Google Cloud response: {}", e))?;
            let translation = body
                .data
                .translations
                .first()
                .ok_or("No translation found in Google Cloud response")?;

            return Ok(TranslateResponse {
                translated_text: translation.translated_text.clone(),
                detected_language: translation
                    .detected_source_language
                    .as_ref()
                    .map(|language| language.to_lowercase()),
                alternatives: Vec::new(),
            });
        }

        let sl = if req.from == "auto" {
            "auto"
        } else {
            &req.from
        };

        let response = client
            .get("https://translate.googleapis.com/translate_a/single")
            .query(&[
                ("client", "gtx"),
                ("sl", sl),
                ("tl", &req.to),
                ("dt", "t"),
                ("dt", "bd"),
                ("dt", "at"),
                ("q", &req.text),
            ])
            .send()
            .await
            .map_err(|e| format!("Google request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let detail = if status.as_u16() == 429 {
                "The public Google endpoint is rate-limited. Add a Google Cloud API key in Settings or wait and retry."
                    .to_string()
            } else {
                response.text().await.unwrap_or_default()
            };
            return Err(format!("Google API error ({}): {}", status, detail));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Google response: {}", e))?;

        let translated_text = body
            .get(0)
            .and_then(|arr| arr.as_array())
            .map(|segments| {
                segments
                    .iter()
                    .filter_map(|seg| seg.get(0).and_then(|t| t.as_str()))
                    .collect::<String>()
            })
            .ok_or("No translation found in Google response")?;

        let detected_language = body
            .get(2)
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase());

        let alternatives = {
            let mut seen = std::collections::HashSet::new();
            let mut alts: Vec<String> = Vec::new();

            let add_alt = |s: &str,
                           seen: &mut std::collections::HashSet<String>,
                           alts: &mut Vec<String>| {
                let cleaned = s.trim().to_string();
                if !cleaned.is_empty() && cleaned != translated_text && seen.insert(cleaned.clone())
                {
                    alts.push(cleaned);
                }
            };

            if let Some(groups) = body.get(1).and_then(|v| v.as_array()) {
                for group in groups {
                    if let Some(terms) = group.get(1).and_then(|t| t.as_array()) {
                        for term in terms {
                            if let Some(s) = term.as_str() {
                                add_alt(s, &mut seen, &mut alts);
                            }
                        }
                    }
                }
            }

            if let Some(phrase_groups) = body.get(5).and_then(|v| v.as_array()) {
                for group in phrase_groups {
                    if let Some(terms) = group.get(2).and_then(|t| t.as_array()) {
                        for term in terms {
                            if let Some(s) = term.get(0).and_then(|t| t.as_str()) {
                                add_alt(s, &mut seen, &mut alts);
                            }
                        }
                    }
                }
            }

            fn extract_strings(
                v: &serde_json::Value,
                seen: &mut std::collections::HashSet<String>,
                alts: &mut Vec<String>,
                main_text: &str,
            ) {
                match v {
                    serde_json::Value::String(s) => {
                        let cleaned = s.trim().to_string();
                        if !cleaned.is_empty()
                            && cleaned.len() > 1
                            && cleaned != main_text
                            && seen.insert(cleaned.clone())
                        {
                            alts.push(cleaned);
                        }
                    }
                    serde_json::Value::Array(arr) => {
                        for item in arr {
                            extract_strings(item, seen, alts, main_text);
                        }
                    }
                    _ => {}
                }
            }

            if let Some(extra) = body.get(6).or_else(|| body.get(4)) {
                extract_strings(extra, &mut seen, &mut alts, &translated_text);
            }

            alts
        };

        Ok(TranslateResponse {
            translated_text,
            detected_language,
            alternatives,
        })
    }

    async fn validate(_client: &reqwest::Client, _api_key: &str) -> Result<bool, String> {
        Ok(true)
    }
}

// bing

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BingResponseItem {
    translations: Vec<BingTranslation>,
    detected_language: Option<BingDetectedLanguage>,
}

#[derive(Deserialize)]
struct BingTranslation {
    text: String,
}

#[derive(Deserialize)]
struct BingDetectedLanguage {
    language: String,
}

impl TranslationProvider for Bing {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        let mut credentials = req
            .api_key
            .trim()
            .splitn(2, |ch: char| ch == ',' || ch == ':');
        let key = credentials.next().unwrap_or("").trim();
        let region = credentials
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        if key.is_empty() {
            return Err(
                "Bing Translator requires an Azure Translator API key. Add it in Settings."
                    .to_string(),
            );
        }

        let mut url = format!(
            "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to={}",
            req.to
        );
        if req.from != "auto" {
            url.push_str(&format!("&from={}", req.from));
        }

        let mut request = client
            .post(&url)
            .header("Ocp-Apim-Subscription-Key", key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!([{"Text": req.text}]));
        if let Some(region) = region {
            request = request.header("Ocp-Apim-Subscription-Region", region);
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Bing request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let detail = if status.as_u16() == 401 {
                "Azure Translator API key is missing or invalid. Use key[,region] in Settings."
                    .to_string()
            } else {
                response.text().await.unwrap_or_default()
            };
            return Err(format!("Bing API error ({}): {}", status, detail));
        }

        let items: Vec<BingResponseItem> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Bing response: {}", e))?;
        let item = items.first().ok_or("No data in Bing response")?;
        let translation = item
            .translations
            .first()
            .ok_or("No translation found in Bing response")?;

        Ok(TranslateResponse {
            translated_text: translation.text.clone(),
            detected_language: item
                .detected_language
                .as_ref()
                .map(|d| d.language.to_lowercase()),
            alternatives: Vec::new(),
        })
    }

    async fn validate(_client: &reqwest::Client, _api_key: &str) -> Result<bool, String> {
        Ok(true)
    }
}

// lara

#[derive(Deserialize)]
struct LaraResponse {
    translation: Option<String>,
    detected_language: Option<String>,
    data: Option<LaraData>,
}

#[derive(Deserialize)]
struct LaraData {
    translation: Option<String>,
    detected_language: Option<String>,
}

impl TranslationProvider for Lara {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        let mut body = serde_json::json!({ "text": req.text, "target": req.to });
        if req.from != "auto" {
            body["source"] = serde_json::json!(req.from);
        }

        let response = client
            .post("https://api.laratranslate.com/v2/translate")
            .header("Authorization", format!("Bearer {}", req.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Lara request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Lara API error ({}): {}",
                response.status(),
                response.text().await.unwrap_or_default()
            ));
        }

        let body: LaraResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Lara response: {}", e))?;
        let translated = body
            .translation
            .or_else(|| body.data.as_ref().and_then(|d| d.translation.clone()))
            .ok_or("No translation found")?;

        Ok(TranslateResponse {
            translated_text: translated,
            detected_language: body
                .detected_language
                .or_else(|| body.data.as_ref().and_then(|d| d.detected_language.clone()))
                .map(|s| s.to_lowercase()),
            alternatives: Vec::new(),
        })
    }

    async fn validate(_client: &reqwest::Client, api_key: &str) -> Result<bool, String> {
        Ok(api_key.trim().len() >= 10)
    }
}

// Baidu Translate

#[derive(Deserialize)]
struct BaiduResponse {
    from: Option<String>,
    #[serde(rename = "trans_result")]
    translations: Option<Vec<BaiduTranslation>>,
    error_code: Option<serde_json::Value>,
    error_msg: Option<String>,
}

#[derive(Deserialize)]
struct BaiduTranslation {
    dst: String,
}

fn md5_hex(value: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

impl TranslationProvider for Baidu {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        let (app_id, secret_key) = parse_credential_pair(&req.api_key, "Baidu Translate")?;
        let salt = format!(
            "{}{}",
            unix_timestamp(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos()
        );
        let sign = md5_hex(&format!("{app_id}{}{salt}{secret_key}", req.text));
        let params = vec![
            ("q", req.text.clone()),
            ("from", baidu_language(&req.from).to_string()),
            ("to", baidu_language(&req.to).to_string()),
            ("appid", app_id.to_string()),
            ("salt", salt),
            ("sign", sign),
        ];

        let response = client
            .get("https://fanyi-api.baidu.com/api/trans/vip/translate")
            .query(&params)
            .send()
            .await
            .map_err(|e| format!("Baidu Translate request failed: {e}"))?;
        let status = response.status();
        let raw = response
            .text()
            .await
            .map_err(|e| format!("Failed to read Baidu Translate response: {e}"))?;
        if !status.is_success() {
            return Err(format!("Baidu Translate API error ({status}): {raw}"));
        }

        let body: BaiduResponse = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse Baidu Translate response: {e}"))?;
        if let Some(error_code) = body.error_code {
            let message = body
                .error_msg
                .unwrap_or_else(|| "Unknown error".to_string());
            return Err(format!(
                "Baidu Translate API error ({error_code}): {message}"
            ));
        }
        let translation = body
            .translations
            .and_then(|items| items.into_iter().next())
            .ok_or("No translation found in Baidu Translate response")?;

        Ok(TranslateResponse {
            translated_text: translation.dst,
            detected_language: body.from.map(|value| value.to_lowercase()),
            alternatives: Vec::new(),
        })
    }

    async fn validate(_client: &reqwest::Client, api_key: &str) -> Result<bool, String> {
        Ok(parse_credential_pair(api_key, "Baidu Translate").is_ok())
    }
}

// Alibaba Cloud

fn aliyun_language(value: &str) -> &str {
    match value {
        "zh-CN" => "zh",
        "zh-TW" => "zh-tw",
        other => other,
    }
}

impl TranslationProvider for Aliyun {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        let (access_key_id, access_key_secret) =
            parse_credential_pair(&req.api_key, "Alibaba Cloud")?;
        let mut params: BTreeMap<String, String> = BTreeMap::from([
            ("AccessKeyId".to_string(), access_key_id.to_string()),
            ("Action".to_string(), "TranslateGeneral".to_string()),
            ("Format".to_string(), "JSON".to_string()),
            ("FormatType".to_string(), "text".to_string()),
            ("Scene".to_string(), "general".to_string()),
            ("SignatureMethod".to_string(), "HMAC-SHA1".to_string()),
            (
                "SignatureNonce".to_string(),
                format!(
                    "{}-{}",
                    unix_timestamp(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .subsec_nanos()
                ),
            ),
            ("SignatureVersion".to_string(), "1.0".to_string()),
            (
                "SourceLanguage".to_string(),
                aliyun_language(&req.from).to_string(),
            ),
            ("SourceText".to_string(), req.text.clone()),
            (
                "TargetLanguage".to_string(),
                aliyun_language(&req.to).to_string(),
            ),
            (
                "Timestamp".to_string(),
                Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            ),
            ("Version".to_string(), "2018-10-12".to_string()),
        ]);
        let canonical_query = params
            .iter()
            .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        let string_to_sign = format!("GET&%2F&{}", percent_encode(&canonical_query));
        let signature = BASE64.encode(hmac_sha1(
            format!("{access_key_secret}&").as_bytes(),
            string_to_sign.as_bytes(),
        ));
        params.insert("Signature".to_string(), signature);
        let query = params
            .iter()
            .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
            .collect::<Vec<_>>()
            .join("&");

        let response = client
            .get(format!("https://mt.cn-hangzhou.aliyuncs.com/?{query}"))
            .send()
            .await
            .map_err(|e| format!("Alibaba Cloud request failed: {e}"))?;
        let status = response.status();
        let raw = response
            .text()
            .await
            .map_err(|e| format!("Failed to read Alibaba Cloud response: {e}"))?;
        if !status.is_success() {
            return Err(format!("Alibaba Cloud API error ({status}): {raw}"));
        }

        let body: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse Alibaba Cloud response: {e}"))?;
        let response_body = body
            .get("TranslateGeneralResponse")
            .or_else(|| body.get("Response"))
            .unwrap_or(&body);
        let translated_text = response_body
            .pointer("/Data/Translated")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                let message = response_body
                    .get("Message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("No translation found");
                format!("Alibaba Cloud API error: {message}")
            })?;
        let detected_language = response_body
            .pointer("/Data/DetectedLanguage")
            .and_then(|value| value.as_str())
            .map(str::to_lowercase);

        Ok(TranslateResponse {
            translated_text: translated_text.to_string(),
            detected_language,
            alternatives: Vec::new(),
        })
    }

    async fn validate(_client: &reqwest::Client, api_key: &str) -> Result<bool, String> {
        Ok(parse_credential_pair(api_key, "Alibaba Cloud").is_ok())
    }
}

impl TranslationProvider for Custom {
    async fn translate(
        client: &reqwest::Client,
        req: &TranslateRequest,
    ) -> Result<TranslateResponse, String> {
        let url = parse_custom_url(&req.api_key)?;

        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "text": req.text,
                "from": req.from,
                "to": req.to,
            }))
            .send()
            .await
            .map_err(|e| format!("Custom API request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!(
                "Custom API error ({}): {}",
                status,
                response.text().await.unwrap_or_default()
            ));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse custom API response: {e}"))?;
        let translated_text = data
            .get("translatedText")
            .or_else(|| data.get("translation"))
            .or_else(|| data.get("text"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| data.to_string());
        let detected_language = data
            .get("detectedLanguage")
            .or_else(|| data.get("detected_language"))
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let alternatives = data
            .get("alternatives")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .filter(|value| !value.trim().is_empty())
                    .collect()
            })
            .unwrap_or_default();

        Ok(TranslateResponse {
            translated_text,
            detected_language,
            alternatives,
        })
    }

    async fn validate(_client: &reqwest::Client, api_key: &str) -> Result<bool, String> {
        Ok(parse_custom_url(api_key).is_ok())
    }
}

#[cfg(test)]
mod tests {
    use super::{baidu_language, parse_credential_pair, parse_custom_url, percent_encode};

    #[test]
    fn custom_url_requires_http_or_https() {
        assert!(parse_custom_url("https://example.com/translate").is_ok());
        assert!(parse_custom_url("file:///tmp/translate").is_err());
    }

    #[test]
    fn provider_credentials_and_query_encoding_are_stable() {
        assert_eq!(
            parse_credential_pair("app-id,secret", "Baidu Translate").unwrap(),
            ("app-id", "secret")
        );
        assert_eq!(baidu_language("ja"), "jp");
        assert_eq!(baidu_language("ko"), "kor");
        assert_eq!(percent_encode("a b+~"), "a%20b%2B~");
    }
}
