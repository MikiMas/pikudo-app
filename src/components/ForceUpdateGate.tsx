import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Linking, Modal, Platform, View } from "react-native";
import { apiFetchJson, DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from "../lib/api";
import { STORAGE_API_BASE } from "../lib/storage";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { H2, Muted } from "../ui/Text";
import { theme } from "../ui/theme";

type VersionCheckRes =
  | { ok: true; revisionVersion: string; clientVersion: string }
  | { ok: false; error: string };

const IOS_STORE_URL = "https://apps.apple.com/us/app/pikudo-juego-para-fiestas/id6757935657";
const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.mikimas.pikudomobile&pcampaignid=web_share";

function normalizeVersion(input: unknown): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^v/i, "");
}

function getInstalledVersionCandidates(): string[] {
  const candidates = new Set<string>();
  const nativeVersion = normalizeVersion(Constants.nativeAppVersion ?? "");
  const expoVersion = normalizeVersion(Constants.expoConfig?.version ?? "");
  if (nativeVersion) candidates.add(nativeVersion);
  if (expoVersion) candidates.add(expoVersion);
  return Array.from(candidates);
}

export function ForceUpdateGate() {
  const [mustUpdate, setMustUpdate] = useState(false);
  const [openingStore, setOpeningStore] = useState(false);

  const storeUrl = useMemo(() => (Platform.OS === "ios" ? IOS_STORE_URL : ANDROID_STORE_URL), []);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      const installedCandidates = getInstalledVersionCandidates();
      if (installedCandidates.length === 0) return;

      const storedBase = await AsyncStorage.getItem(STORAGE_API_BASE).catch(() => null);
      const apiBase = normalizeApiBaseUrl(storedBase ?? DEFAULT_API_BASE_URL);

      const res = await apiFetchJson<VersionCheckRes>(apiBase, "/api/pikudo/app/version", {
        method: "GET",
        auth: false
      });
      if (canceled) return;
      if (!res.ok) return;

      const payload = res.data as VersionCheckRes;
      if (!payload || payload.ok === false) return;

      const revisionVersion = normalizeVersion(payload.revisionVersion);
      const clientVersion = normalizeVersion(payload.clientVersion);
      if (!revisionVersion || !clientVersion) return;

      const allowed = installedCandidates.some((v) => v === revisionVersion || v === clientVersion);
      setMustUpdate(!allowed);
    };

    run().catch(() => {});
    return () => {
      canceled = true;
    };
  }, []);

  const openStore = async () => {
    if (openingStore) return;
    setOpeningStore(true);
    try {
      const supported = await Linking.canOpenURL(storeUrl);
      if (!supported) return;
      await Linking.openURL(storeUrl);
    } catch {
      // Keep modal open; user can retry.
    } finally {
      setOpeningStore(false);
    }
  };

  return (
    <Modal transparent visible={mustUpdate} animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, padding: 18, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" }}>
        <View style={{ width: "100%", maxWidth: 420, alignSelf: "center" }}>
          <Card style={{ borderColor: theme.colors.buttonPrimaryBorder, backgroundColor: theme.colors.card }}>
            <H2 style={{ fontSize: 20, color: theme.colors.text }}>Nueva version disponible</H2>
            <Muted style={{ marginTop: 8, color: theme.colors.text }}>
              Hay una nueva version de PIKUDO. Actualiza la app para seguir jugando.
            </Muted>
            <View style={{ marginTop: 14 }}>
              <Button variant="secondary" onPress={openStore} disabled={openingStore}>
                {openingStore ? "Abriendo store..." : "Actualizar"}
              </Button>
            </View>
          </Card>
        </View>
      </View>
    </Modal>
  );
}
