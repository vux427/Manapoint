use std::fmt;

/// Why a collection failed, which decides whether the card keeps its last numbers:
/// NotReady and Transient keep them and add a line of explanation, Failed clears them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollectError {
    /// The provider is not usable yet — not installed, not signed in, or expired.
    /// The message is shown to the user verbatim, so it has to be an instruction they
    /// can act on.
    NotReady(String),

    /// Rate limited, timed out, connection dropped. The next poll usually recovers.
    Transient(String),

    /// Hard failure: unexpected response shape or status code.
    Failed(String),
}

impl CollectError {
    pub fn not_ready(msg: impl Into<String>) -> Self {
        Self::NotReady(msg.into())
    }

    pub fn transient(msg: impl Into<String>) -> Self {
        Self::Transient(msg.into())
    }

    pub fn failed(msg: impl Into<String>) -> Self {
        Self::Failed(msg.into())
    }

    /// Whether the previous reading is still worth showing. Both NotReady and Transient
    /// mean "temporarily unavailable", and a stale number beats a column of red.
    pub fn keeps_last_good(&self) -> bool {
        matches!(self, Self::NotReady(_) | Self::Transient(_))
    }

    pub fn message(&self) -> &str {
        match self {
            Self::NotReady(m) | Self::Transient(m) | Self::Failed(m) => m,
        }
    }
}

impl fmt::Display for CollectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for CollectError {}

pub type CollectResult<T> = Result<T, CollectError>;

/// Timeouts, connection problems and 429 are temporary; any other status is hard.
impl From<reqwest::Error> for CollectError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            return Self::Transient("連線逾時".into());
        }
        if err.is_connect() || err.is_request() {
            return Self::Transient(format!("連線失敗，稍後自動重試（{err}）"));
        }
        match err.status() {
            Some(s) if s.as_u16() == 429 => {
                Self::Transient("請求太頻繁，顯示上次數字，稍後自動重試".into())
            }
            Some(s) => Self::Failed(format!("連線失敗：{}", s.as_u16())),
            None => Self::Failed(format!("連線失敗：{err}")),
        }
    }
}

/// A malformed response breaks one card, not the whole poll.
impl From<serde_json::Error> for CollectError {
    fn from(err: serde_json::Error) -> Self {
        Self::Failed(format!("回應格式不符：{err}"))
    }
}
