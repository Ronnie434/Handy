import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";
import { commands, type FrontmostApp } from "@/bindings";

import { Dropdown, SettingContainer } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { ResetButton } from "../../ui/ResetButton";
import { useSettings } from "../../../hooks/useSettings";

const PostProcessingAppRulesComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const [lastApp, setLastApp] = useState<FrontmostApp | null>(null);
  // App id of the rule being edited; null while adding a new rule.
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [draftAppId, setDraftAppId] = useState("");
  const [draftAppName, setDraftAppName] = useState("");
  const [draftPromptId, setDraftPromptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rules = getSetting("post_process_app_rules") || [];
  const prompts = getSetting("post_process_prompts") || [];
  const promptOptions = prompts.map((p) => ({ value: p.id, label: p.name }));

  const refreshLastApp = useCallback(async () => {
    try {
      setLastApp(await commands.getLastDetectedApp());
    } catch (err) {
      console.error("Failed to get last detected app:", err);
    }
  }, []);

  useEffect(() => {
    refreshLastApp();
  }, [refreshLastApp]);

  const resetForm = () => {
    setEditingAppId(null);
    setDraftAppId("");
    setDraftAppName("");
    setDraftPromptId(null);
    setError(null);
  };

  const saveRule = async (
    previousAppId: string | null,
    appId: string,
    appName: string,
    promptId: string,
  ) => {
    const result = await commands.upsertPostProcessAppRule(
      previousAppId,
      appId,
      appName,
      promptId,
    );
    if (result.status === "error") {
      setError(result.error);
      return false;
    }
    await refreshSettings();
    return true;
  };

  const handleSubmit = async () => {
    if (!draftAppId.trim() || !draftPromptId) return;
    if (
      await saveRule(
        editingAppId,
        draftAppId.trim(),
        draftAppName.trim(),
        draftPromptId,
      )
    ) {
      resetForm();
    }
  };

  const handleEdit = (appId: string) => {
    const rule = rules.find((r) => r.app_id === appId);
    if (!rule) return;
    setEditingAppId(rule.app_id);
    setDraftAppId(rule.app_id);
    setDraftAppName(rule.app_name ?? "");
    setDraftPromptId(rule.prompt_id);
    setError(null);
  };

  const handleDelete = async (appId: string) => {
    const result = await commands.deletePostProcessAppRule(appId);
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    if (editingAppId === appId) resetForm();
    await refreshSettings();
  };

  const handleUseLastApp = () => {
    if (!lastApp) return;
    setDraftAppId(lastApp.id);
    setDraftAppName(lastApp.name);
  };

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.appRules.lastDetected.title")}
        description={t(
          "settings.postProcessing.appRules.lastDetected.description",
        )}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <div className="flex items-center gap-2 min-w-0">
          {lastApp ? (
            <span className="text-sm truncate" title={lastApp.id}>
              {lastApp.name}{" "}
              <span className="text-mid-gray/70">({lastApp.id})</span>
            </span>
          ) : (
            <span className="text-sm text-mid-gray/70">
              {t("settings.postProcessing.appRules.lastDetected.none")}
            </span>
          )}
          <Button
            onClick={handleUseLastApp}
            variant="secondary"
            size="sm"
            disabled={!lastApp}
            className="shrink-0"
          >
            {t("settings.postProcessing.appRules.lastDetected.use")}
          </Button>
          <ResetButton
            onClick={refreshLastApp}
            ariaLabel={t(
              "settings.postProcessing.appRules.lastDetected.refresh",
            )}
            className="flex h-8 w-8 items-center justify-center shrink-0"
          >
            <RefreshCcw className="h-4 w-4" />
          </ResetButton>
        </div>
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.appRules.rules.title")}
        description={t("settings.postProcessing.appRules.rules.description")}
        descriptionMode="tooltip"
        layout="stacked"
        grouped={true}
      >
        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="p-3 bg-mid-gray/5 rounded-md border border-mid-gray/20">
              <p className="text-sm text-mid-gray">
                {t("settings.postProcessing.appRules.rules.empty")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => {
                const promptName =
                  prompts.find((p) => p.id === rule.prompt_id)?.name ??
                  t("settings.postProcessing.appRules.rules.missingPrompt");
                return (
                  <div
                    key={rule.app_id}
                    className="flex items-center gap-2 p-2 rounded-md border border-mid-gray/20"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {rule.app_name || rule.app_id}
                      </p>
                      <p className="text-xs text-mid-gray/70 truncate">
                        {rule.app_id}
                      </p>
                    </div>
                    <span className="text-sm truncate max-w-[40%]">
                      {promptName}
                    </span>
                    <Button
                      onClick={() => handleEdit(rule.app_id)}
                      variant="secondary"
                      size="sm"
                    >
                      {t("settings.postProcessing.appRules.rules.edit")}
                    </Button>
                    <Button
                      onClick={() => handleDelete(rule.app_id)}
                      variant="danger-ghost"
                      size="sm"
                    >
                      {t("settings.postProcessing.appRules.rules.delete")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <label className="text-sm font-semibold">
              {editingAppId
                ? t("settings.postProcessing.appRules.form.editTitle")
                : t("settings.postProcessing.appRules.form.addTitle")}
            </label>
            <div className="flex gap-2 min-w-0">
              <Input
                type="text"
                value={draftAppId}
                onChange={(e) => setDraftAppId(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.appRules.form.appIdPlaceholder",
                )}
                variant="compact"
                className="flex-1 min-w-0"
              />
              <Input
                type="text"
                value={draftAppName}
                onChange={(e) => setDraftAppName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.appRules.form.appNamePlaceholder",
                )}
                variant="compact"
                className="flex-1 min-w-0"
              />
            </div>
            <div className="flex gap-2 min-w-0">
              <Dropdown
                selectedValue={draftPromptId}
                options={promptOptions}
                onSelect={(value) => setDraftPromptId(value)}
                placeholder={t("settings.postProcessing.prompts.selectPrompt")}
                className="flex-1 min-w-0"
              />
              <Button
                onClick={handleSubmit}
                variant="primary"
                size="md"
                disabled={!draftAppId.trim() || !draftPromptId}
                className="shrink-0"
              >
                {editingAppId
                  ? t("settings.postProcessing.appRules.form.save")
                  : t("settings.postProcessing.appRules.form.add")}
              </Button>
              {editingAppId && (
                <Button
                  onClick={resetForm}
                  variant="secondary"
                  size="md"
                  className="shrink-0"
                >
                  {t("settings.postProcessing.prompts.cancel")}
                </Button>
              )}
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </div>
      </SettingContainer>
    </>
  );
};

export const PostProcessingAppRules = React.memo(
  PostProcessingAppRulesComponent,
);
PostProcessingAppRules.displayName = "PostProcessingAppRules";
