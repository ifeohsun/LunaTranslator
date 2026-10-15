use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Default, Serialize)]
pub(crate) struct SelectionSnapshot {
    pub id: u64,
    pub revision: u64,
    pub text: String,
    pub pending: bool,
    pub visible: bool,
    pub failed: bool,
}

impl SelectionSnapshot {
    pub fn begin(&mut self) -> u64 {
        self.id += 1;
        self.revision += 1;
        self.text.clear();
        self.pending = true;
        self.visible = true;
        self.failed = false;
        self.id
    }

    pub fn is_current(&self, id: u64) -> bool {
        self.visible && self.id == id
    }

    pub fn finish(&mut self, id: u64, text: String, failed: bool) -> bool {
        if !self.is_current(id) || !self.pending {
            return false;
        }
        self.revision += 1;
        self.text = text;
        self.failed = failed;
        self.pending = false;
        true
    }

    pub fn cancel(&mut self) {
        self.id += 1;
        self.revision += 1;
        self.text.clear();
        self.pending = false;
        self.visible = false;
        self.failed = false;
    }
}

#[derive(Default)]
pub(crate) struct SelectionState {
    pub snapshot: Mutex<SelectionSnapshot>,
    pub capture: tokio::sync::Mutex<()>,
}

#[test]
fn latest_selection_survives_repeats_and_close() {
    let mut snapshot = SelectionSnapshot::default();
    let first = snapshot.begin();
    let second = snapshot.begin();
    assert!(!snapshot.finish(first, "old".into(), false));
    assert!(snapshot.finish(second, "same text".into(), false));
    let revision = snapshot.revision;
    // Reading the snapshot never consumes it, even before the webview is ready.
    assert_eq!(snapshot.clone().text, "same text");
    assert_eq!(snapshot.clone().revision, revision);
    let third = snapshot.begin();
    assert!(snapshot.finish(third, "same text".into(), false));
    assert!(snapshot.revision > revision);
    let fourth = snapshot.begin();
    snapshot.cancel();
    assert!(!snapshot.finish(fourth, "late copy".into(), false));
    assert!(!snapshot.visible);
    let empty = snapshot.begin();
    assert!(snapshot.finish(empty, String::new(), false));
    assert!(!snapshot.finish(fourth, "late copy after reopening".into(), false));
    assert!(snapshot.visible && snapshot.text.is_empty() && !snapshot.pending);
}
