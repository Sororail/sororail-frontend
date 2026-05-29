use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

#[derive(Clone, Default)]
pub struct Cache {
    inner: Arc<RwLock<HashMap<String, (Instant, Duration, serde_json::Value)>>>,
}

impl Cache {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let map = self.inner.read().await;
        if let Some((ts, ttl, v)) = map.get(key) {
            if ts.elapsed() <= *ttl {
                return serde_json::from_value(v.clone()).ok();
            }
        }
        None
    }

    pub async fn set<T: Serialize>(&self, key: &str, value: &T, ttl: Duration) {
        let mut map = self.inner.write().await;
        if let Ok(v) = serde_json::to_value(value) {
            map.insert(key.to_string(), (Instant::now(), ttl, v));
        }
    }

    pub async fn invalidate(&self, key: &str) {
        let mut map = self.inner.write().await;
        map.remove(key);
    }
}
