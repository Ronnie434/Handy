import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";

import { SettingContainer, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { ShortcutInput } from "../ShortcutInput";
import { useSettings } from "../../../hooks/useSettings";

const PostProcessingCommandModeComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const selectionCommands =
    getSetting("post_process_selection_commands") ?? true;
  const savedPrompt = getSetting("command_mode_prompt") || "";
  const [draft, setDraft] = useState(savedPrompt);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(savedPrompt);
  }, [savedPrompt]);

  const handleSave = async () => {
    const result = await commands.changeCommandModePromptSetting(draft.trim());
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    setError(null);
    await refreshSettings();
  };

  const handleReset = async () => {
    const result = await commands.resetCommandModePrompt();
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(result.data);
    await refreshSettings();
  };

  const isDirty = draft.trim() !== savedPrompt.trim();

  return (
    <>
      <ToggleSwitch
        checked={selectionCommands}
        onChange={(enabled) =>
          updateSetting("post_process_selection_commands", enabled)
        }
        isUpdating={isUpdating("post_process_selection_commands")}
        label={t("settings.postProcessing.commandMode.selectionCommands.label")}
        description={t(
          "settings.postProcessing.commandMode.selectionCommands.description",
        )}
        descriptionMode="tooltip"
        grouped={true}
      />

      <ShortcutInput
        shortcutId="command_mode"
        descriptionMode="tooltip"
        grouped={true}
      />

      <SettingContainer
        title={t("settings.postProcessing.commandMode.prompt.title")}
        description={t(
          "settings.postProcessing.commandMode.prompt.description",
        )}
        descriptionMode="tooltip"
        layout="stacked"
        grouped={true}
      >
        <div className="space-y-3">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="text-xs text-mid-gray/70">
            {t("settings.postProcessing.commandMode.prompt.tip")}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              variant="primary"
              size="md"
              disabled={!draft.trim() || !isDirty}
            >
              {t("settings.postProcessing.commandMode.prompt.save")}
            </Button>
            <Button onClick={handleReset} variant="secondary" size="md">
              {t("settings.postProcessing.commandMode.prompt.reset")}
            </Button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </SettingContainer>
    </>
  );
};

export const PostProcessingCommandMode = React.memo(
  PostProcessingCommandModeComponent,
);
PostProcessingCommandMode.displayName = "PostProcessingCommandMode";
