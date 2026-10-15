"use client";

import { useState } from "react";
import { Heart, X } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { useI18n } from "@/lib/useI18n";

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CHANGELOG_ITEMS = [
  "changelog.item.ui",
  "changelog.item.shadow",
  "changelog.item.text",
  "changelog.item.copy",
  "changelog.item.hotkey",
] as const;

export default function ChangelogModal({
  isOpen,
  onClose,
}: ChangelogModalProps) {
  const { t } = useI18n();
  const [isClosing, setIsClosing] = useState(false);

  if (!isOpen && !isClosing) return null;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 300);
  };

  return (
    <>
      <style jsx global>{`
        @keyframes changelogFadeIn {
          from { opacity: 0; backdrop-filter: blur(0); }
          to { opacity: 1; backdrop-filter: blur(4px); }
        }

        @keyframes changelogSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes changelogFadeOut {
          from { opacity: 1; backdrop-filter: blur(4px); }
          to { opacity: 0; backdrop-filter: blur(0); }
        }

        @keyframes changelogSlideDown {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(20px) scale(0.96); }
        }

        .changelog-bg-in { animation: changelogFadeIn 0.3s ease-out forwards; }
        .changelog-modal-in { animation: changelogSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .changelog-bg-out { animation: changelogFadeOut 0.3s ease-in forwards; }
        .changelog-modal-out { animation: changelogSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>

      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${isClosing ? "changelog-bg-out" : "changelog-bg-in"}`}
      >
        <div
          className={`bg-surface-high rounded-(--md-shape-lg) w-[90vw] max-w-3xl max-h-[85vh] flex flex-col m-4 relative ${isClosing ? "changelog-modal-out" : "changelog-modal-in"}`}
        >
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <div className="w-8 h-8" />
            <div className="flex items-center justify-center gap-2">
              <h2 className="text-2xl font-semibold text-center">
                {t("changelog.title", { version: APP_VERSION })}
              </h2>
              <Heart size={28} className="shrink-0 text-primary fill-primary/20" />
            </div>
            <button onClick={handleClose} className="md-icon-btn w-8 h-8">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 pb-6 text-center">
            <p className="mb-3 text-secondary">{t("changelog.summary")}</p>
            <ul className="space-y-3 mb-6">
              {CHANGELOG_ITEMS.map((key) => (
                <li key={key} className="leading-relaxed px-4">
                  <span className="text-primary mr-2">•</span>
                  {t(key)}
                </li>
              ))}
            </ul>
            <p className="text-sm text-secondary">{t("changelog.credits")}</p>
          </div>

          <div className="px-6 pt-5 pb-5 flex justify-center shrink-0">
            <button
              onClick={handleClose}
              className="px-8 py-2.5 cursor-pointer rounded-full bg-primary text-on-primary font-medium hover:brightness-110 transition-all"
            >
              {t("common.gotIt")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
