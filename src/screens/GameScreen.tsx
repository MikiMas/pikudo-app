import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ActivityIndicator, Image, Modal, Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiFetchJson, buildApiUrlCandidates, getDeviceId, getSessionToken } from "../lib/api";
import { normalizeErrorMessage } from "../lib/errorModal";
import { VideoPreview } from "../components/VideoPreview";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { H2, Muted, Title } from "../ui/Text";
import { theme } from "../ui/theme";
import type { Challenge, Leader, Player, RoomState } from "./roomTypes";

type AdminConfirmAction = "end" | "transfer" | "leave";
type AdminConfirmPayload = {
  action: AdminConfirmAction;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant: "secondary" | "danger";
};
type UploadProgressState = {
  id: string;
  pct: number;
  mode: "upload" | "delete";
};

export function GameScreen({
  apiBaseUrl,
  roomCode,
  state,
  isOwner,
  loading,
  error,
  nextBlockInSec,
  challenges,
  leaders,
  player,
  totalRounds,
  roomStartsAt,
  uploadingById,
  uploadErrorById,
  setUploadingById,
  setUploadErrorById,
  setChallenges,
  setNextBlockInSec,
  setState,
  setLeaders,
  manualRefreshing,
  onManualRefresh,
  onExitHome
}: {
  apiBaseUrl: string;
  roomCode: string;
  state: RoomState;
  isOwner: boolean;
  loading: boolean;
  error: string | null;
  nextBlockInSec: number;
  challenges: Challenge[];
  leaders: Leader[];
  player: Player | null;
  totalRounds: number;
  roomStartsAt: string | null;
  uploadingById: Record<string, boolean>;
  uploadErrorById: Record<string, string | null>;
  setUploadingById: Dispatch<SetStateAction<Record<string, boolean>>>;
  setUploadErrorById: Dispatch<SetStateAction<Record<string, string | null>>>;
  setChallenges: Dispatch<SetStateAction<Challenge[]>>;
  setNextBlockInSec: Dispatch<SetStateAction<number>>;
  setState: Dispatch<SetStateAction<RoomState>>;
  setLeaders: Dispatch<SetStateAction<Leader[]>>;
  manualRefreshing: boolean;
  onManualRefresh: () => Promise<void>;
  onExitHome: () => Promise<void>;
}) {
  const completedCount = useMemo(() => challenges.filter((c) => c.completed).length, [challenges]);
  const nextMinutes = Math.max(1, Math.ceil(nextBlockInSec / 60));
  const nextLabel =
    nextBlockInSec <= 0
      ? "Ahora"
      : nextBlockInSec < 60
        ? `${nextBlockInSec} s`
        : `${nextMinutes} min`;

  const currentRound = useMemo(() => {
    if (!roomStartsAt) return 1;
    const started = new Date(roomStartsAt).getTime();
    if (!Number.isFinite(started)) return 1;
    const now = Date.now();
    const minutes = Math.max(0, Math.floor((now - started) / 60000));
    const round = Math.floor(minutes / 30) + 1;
    return Math.min(Math.max(round, 1), Math.max(totalRounds, 1));
  }, [roomStartsAt, totalRounds, nextBlockInSec]);

  const points = useMemo(() => {
    if (!player?.nickname) return player?.points ?? 0;
    const leader = leaders.find((l) => l.nickname === player.nickname);
    return leader ? leader.points : player?.points ?? 0;
  }, [leaders, player?.nickname, player?.points]);

  const position = useMemo(() => {
    if (!player?.nickname) return null;
    const idx = leaders.findIndex((l) => l.nickname === player.nickname);
    return idx >= 0 ? idx + 1 : null;
  }, [leaders, player?.nickname]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: "image" | "video" } | null>(null);

  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [leadersRefreshing, setLeadersRefreshing] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirmPayload | null>(null);
  const MEDIA_PICK_QUALITY = 0.75;

  const mediaTypes = (kind: "all" | "image" | "video") => {
    const ip: any = ImagePicker as any;
    if (ip.MediaType) {
      if (kind === "image") return [ip.MediaType.Images];
      if (kind === "video") return [ip.MediaType.Videos];
      return [ip.MediaType.Images, ip.MediaType.Videos];
    }
    if (kind === "image") return ["images"] as any;
    if (kind === "video") return ["videos"] as any;
    return ["images", "videos"] as any;
  };

  const uploadWithProgress = async (form: FormData, onProgress: (pct: number) => void) => {
    const urls = buildApiUrlCandidates(apiBaseUrl, "/api/pikudo/upload");
    const deviceId = await getDeviceId();
    const session = await getSessionToken();

    const readError = (data: any) => {
      const fromError = typeof data?.error === "string" ? data.error.trim() : "";
      if (fromError) return fromError;
      const fromMessage = typeof data?.message === "string" ? data.message.trim() : "";
      if (fromMessage) return fromMessage;
      return "REQUEST_FAILED";
    };

    const fallbackErrorByStatus = (status: number) => {
      if (status === 401) return "UNAUTHORIZED";
      if (status === 403) return "FORBIDDEN";
      if (status === 404) return "NOT_FOUND";
      if (status === 413) return "FILE_TOO_LARGE";
      if (status === 429) return "RATE_LIMITED";
      if (status >= 500) return "INTERNAL_ERROR";
      return "REQUEST_FAILED";
    };

    const sendToViaFetch = async (url: string) => {
      const headers: Record<string, string> = { "x-device-id": deviceId };
      if (session) headers["x-session-token"] = session;

      try {
        const res = await fetch(url, { method: "POST", headers, body: form as any });
        const json = await res.json().catch(() => null);
        if (res.ok) return { ok: true, status: res.status, data: json };
        const parsedError = readError(json);
        const error = parsedError === "REQUEST_FAILED" ? fallbackErrorByStatus(res.status) : parsedError;
        return { ok: false, status: res.status, data: json, error };
      } catch {
        return { ok: false, status: 0, data: null, error: "NETWORK_ERROR" };
      }
    };

    const sendToViaXhr = (url: string) =>
      new Promise<{ ok: boolean; status: number; data: any; error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("x-device-id", deviceId);
        if (session) xhr.setRequestHeader("x-session-token", session);
        xhr.onload = () => {
          let json: any = null;
          try {
            json = JSON.parse(xhr.responseText || "null");
          } catch {
            json = null;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ok: true, status: xhr.status, data: json });
          } else {
            const parsedError = readError(json);
            const error = parsedError === "REQUEST_FAILED" ? fallbackErrorByStatus(xhr.status) : parsedError;
            resolve({ ok: false, status: xhr.status, data: json, error });
          }
        };
        xhr.onerror = () => resolve({ ok: false, status: 0, data: null, error: "NETWORK_ERROR" });
        xhr.upload.onprogress = (evt) => {
          if (!evt.lengthComputable) return;
          const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
          onProgress(pct);
        };
        xhr.send(form as any);
      });

    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      console.log("[PIKUDO APP API]", "POST", url);

      let result = await sendToViaXhr(url);
      if (result.status === 0) {
        result = await sendToViaFetch(url);
      }

      console.log("[PIKUDO APP API]", result.status, url);

      if (result.ok) return result;
      if (result.status === 404 && index < urls.length - 1) {
        continue;
      }
      return result;
    }

    return { ok: false, status: 0, data: null, error: "NETWORK_ERROR" };
  };
  const handlePickMedia = async (challengeId: string, source: "camera" | "gallery", media: "all" | "image" | "video" = "image") => {
    setUploadErrorById((m) => ({ ...m, [challengeId]: null }));
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: "Permiso de camara denegado." }));
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: "Permiso de galeria denegado." }));
        return;
      }
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: mediaTypes(media === "image" ? "image" : media === "video" ? "video" : "all"),
            quality: MEDIA_PICK_QUALITY,
            videoMaxDuration: 180
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: mediaTypes(media === "image" ? "image" : media === "video" ? "video" : "all"),
            quality: MEDIA_PICK_QUALITY,
            videoMaxDuration: 180
          });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    const mime = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
    const isVideo = mime.startsWith("video/");
    const name = asset.fileName || `reto_${challengeId}.${isVideo ? "mp4" : "jpg"}`;

    setUploadingById((m) => ({ ...m, [challengeId]: true }));
    setUploadProgress({ id: challengeId, pct: 0, mode: "upload" });
    try {
      const form = new FormData();
      form.append("playerChallengeId", challengeId);
      form.append("file", { uri: asset.uri, name, type: mime } as any);

      const up = await uploadWithProgress(form, (pct) => {
        setUploadProgress({ id: challengeId, pct, mode: "upload" });
      });
      if (!up.ok) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: up.error ?? "UPLOAD_FAILED" }));
        return;
      }
      if ((up.data as any)?.ok === false) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: (up.data as any)?.error ?? "UPLOAD_FAILED" }));
        return;
      }

      const done = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerChallengeId: challengeId })
      });
      if (!done.ok) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: done.error }));
        return;
      }
      if ((done.data as any)?.ok === false) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: (done.data as any)?.error ?? "COMPLETE_FAILED" }));
        return;
      }

      const refreshed = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/challenges", { method: "GET" });
      if (refreshed.ok) {
        const data: any = refreshed.data as any;
        setChallenges((data?.challenges ?? []) as any);
        setNextBlockInSec(Number(data?.nextBlockInSec ?? 0) || 0);
        const s = String(data?.state ?? "running") as any;
        if (s === "ended") setState("ended");
        else setState("running");
      }
      const refreshedLeaders = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/leaderboard", { method: "GET" });
      if (refreshedLeaders.ok) setLeaders(((refreshedLeaders.data as any)?.leaders ?? []) as any);
    } finally {
      setUploadingById((m) => ({ ...m, [challengeId]: false }));
      setUploadProgress((p) => (p?.id === challengeId ? null : p));
    }
  };

  const handleDeleteMedia = async (challengeId: string) => {
    setUploadErrorById((m) => ({ ...m, [challengeId]: null }));
    setUploadingById((m) => ({ ...m, [challengeId]: true }));
    setUploadProgress({ id: challengeId, pct: 0, mode: "delete" });
    try {
      const res = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/challenges/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerChallengeId: challengeId })
      });
      if (!res.ok) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: res.error }));
        return;
      }
      if ((res.data as any)?.ok === false) {
        setUploadErrorById((m) => ({ ...m, [challengeId]: (res.data as any)?.error ?? "DELETE_FAILED" }));
        return;
      }

      const refreshed = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/challenges", { method: "GET" });
      if (refreshed.ok) {
        const data: any = refreshed.data as any;
        setChallenges((data?.challenges ?? []) as any);
        setNextBlockInSec(Number(data?.nextBlockInSec ?? 0) || 0);
        const s = String(data?.state ?? "running") as any;
        if (s === "ended") setState("ended");
        else setState("running");
      }
      const refreshedLeaders = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/leaderboard", { method: "GET" });
      if (refreshedLeaders.ok) setLeaders(((refreshedLeaders.data as any)?.leaders ?? []) as any);
    } finally {
      setUploadingById((m) => ({ ...m, [challengeId]: false }));
      setUploadProgress((p) => (p?.id === challengeId ? null : p));
    }
  };

  const handleAdminAction = async (action: "transfer" | "leave") => {
    if (adminLoading) return;
    setAdminError(null);
    setAdminLoading(true);
    let success = false;
    try {
      if (action === "transfer") {
        const res = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/rooms/leave-transfer", { method: "POST" });
        if (!res.ok) throw new Error(res.error);
        if ((res.data as any)?.ok === false) throw new Error((res.data as any)?.error ?? "REQUEST_FAILED");
      } else {
        const res = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/rooms/leave", { method: "POST" });
        if (!res.ok) throw new Error(res.error);
        if ((res.data as any)?.ok === false) throw new Error((res.data as any)?.error ?? "REQUEST_FAILED");
      }
      success = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "REQUEST_FAILED";
      setAdminError(msg);
    } finally {
      setAdminLoading(false);
      if (success) {
        setAdminOpen(false);
        await onExitHome();
      } else {
        setAdminOpen(true);
      }
    }
  };

  const handleAdminEnd = async () => {
    if (adminLoading) return;
    setAdminError(null);
    setAdminLoading(true);
    try {
      const res = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/rooms/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: roomCode })
      });
      if (!res.ok) throw new Error(res.error);
      if ((res.data as any)?.ok === false) throw new Error((res.data as any)?.error ?? "REQUEST_FAILED");
      setAdminOpen(false);
      setState("ended");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "REQUEST_FAILED";
      setAdminError(msg);
      setAdminOpen(true);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleRefreshLeaders = async () => {
    if (leadersRefreshing) return;
    setLeadersRefreshing(true);
    try {
      const refreshedLeaders = await apiFetchJson<any>(apiBaseUrl, "/api/pikudo/leaderboard", { method: "GET" });
      if (refreshedLeaders.ok && (refreshedLeaders.data as any)?.ok !== false) {
        setLeaders(((refreshedLeaders.data as any)?.leaders ?? []) as any);
      }
    } finally {
      setLeadersRefreshing(false);
    }
  };

  const handleAdminConfirm = async () => {
    if (!adminConfirm || adminLoading) return;
    const action = adminConfirm.action;
    setAdminConfirm(null);
    if (action === "end") {
      await handleAdminEnd();
      return;
    }
    await handleAdminAction(action);
  };

  return (
    <View style={{ gap: 10, position: "relative", paddingTop: 36 }}>
      <Title
        style={{
          position: "absolute",
          left: 6,
          top: -2,
          zIndex: 20,
          fontSize: 28,
          letterSpacing: 2.2,
          textShadowColor: "rgba(0,0,0,0.75)",
          textShadowOffset: { width: 0, height: 4 },
          textShadowRadius: 10
        }}
      >
        {roomCode}
      </Title>
      <Pressable
        onPress={() => {
          setAdminError(null);
          setAdminOpen(true);
        }}
        style={{
          position: "absolute",
          right: 6,
          top: 0,
          zIndex: 20,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: theme.colors.danger,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.colors.danger,
          elevation: 6
        }}
      >
        <Muted style={{ color: theme.colors.textOnPrimary, fontWeight: "900", fontSize: 16 }}>X</Muted>
      </Pressable>
      <Card style={{ marginBottom: 2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Muted style={{ color: theme.colors.muted }}>Puntos</Muted>
            <H2>{points}</H2>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Muted style={{ color: theme.colors.muted }}>Puesto</Muted>
            <H2>{position ? `#${position}` : "-"}</H2>
          </View>
        </View>
        {loading ? <Muted style={{ marginTop: 8 }}>Cargando sala...</Muted> : null}
        {error ? <Muted style={{ marginTop: 8, color: theme.colors.danger }}>{normalizeErrorMessage(error)}</Muted> : null}
      </Card>

      <Card style={{ marginBottom: 2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Muted>Ronda {currentRound} / {Math.max(totalRounds, 1)}</Muted>
          <Muted>Próximos retos en {nextLabel}</Muted>
        </View>
      </Card>

      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <H2>Retos</H2>
            <Pressable
              disabled={manualRefreshing}
              onPress={() => {
                if (manualRefreshing) return;
                onManualRefresh().catch(() => {});
              }}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(140,200,255,0.55)",
                backgroundColor: pressed ? "rgba(140,200,255,0.26)" : "rgba(140,200,255,0.18)",
                opacity: manualRefreshing ? 0.6 : 1
              })}
            >
              {manualRefreshing ? (
                <ActivityIndicator size="small" color={theme.colors.text} />
              ) : (
                <Muted style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>{"\u21bb"}</Muted>
              )}
            </Pressable>
          </View>
          <Muted>{completedCount} / {challenges.length} completados</Muted>
        </View>
        <View style={{ height: 10 }} />
        {challenges.length === 0 ? (
          <Muted>Cargando retos...</Muted>
        ) : (
          <View>
            {challenges.map((c) => (
              <Card
                key={c.id}
                style={{
                  borderColor: theme.colors.buttonPrimaryBorder,
                  backgroundColor: theme.colors.buttonPrimary,
                  padding: 12,
                  marginBottom: 10,
                  overflow: "hidden"
                }}
              >
                <View
                  style={{
                    backgroundColor: theme.colors.buttonSecondary,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    margin: -12,
                    marginBottom: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.buttonSecondaryBorder
                  }}
                >
                  <Muted style={{ color: theme.colors.textOnPrimary, fontWeight: "900", textAlign: "center" }}>{c.title}</Muted>
                </View>
                {c.description ? <Muted style={{ marginTop: 6 }}>{c.description}</Muted> : null}
                <Muted style={{ marginTop: 8, fontWeight: "800" }}>{c.completed ? "Completado" : "Pendiente"}</Muted>

                {c.media?.url ? (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {c.media.type === "video" ? (
                      <VideoPreview url={c.media.url} />
                    ) : (
                      <Image
                        source={{ uri: c.media.url }}
                        style={{
                          width: "100%",
                          height: 240,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: "rgba(0,0,0,0.25)"
                        }}
                        resizeMode="contain"
                      />
                    )}

                    <View style={{ flexDirection: "row", gap: 12, justifyContent: "center", alignItems: "center" }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onPress={() => {
                          if ((c.media?.type === "image" || c.media?.type === "video") && c.media.url) {
                            setPreviewMedia({ url: c.media.url, type: c.media.type });
                          }
                        }}
                      >
                        <Image
                          source={require("../../assets/ojo-abierto.png")}
                          style={{ width: 20, height: 20, tintColor: theme.colors.text }}
                          resizeMode="contain"
                        />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        fullWidth={false}
                        disabled={Boolean(uploadingById[c.id])}
                        onPress={() => {
                          setConfirmDeleteId(c.id);
                        }}
                      >
                        {uploadingById[c.id] ? (
                          <Image
                            source={require("../../assets/cubo-de-basura.png")}
                            style={{ width: 20, height: 20, tintColor: theme.colors.textOnPrimary, opacity: 0.6 }}
                            resizeMode="contain"
                          />
                        ) : (
                          <Image
                            source={require("../../assets/cubo-de-basura.png")}
                            style={{ width: 20, height: 20, tintColor: theme.colors.textOnPrimary }}
                            resizeMode="contain"
                          />
                        )}
                      </Button>
                    </View>
                  </View>
                ) : null}

                {!c.completed ? (
                  <View style={{ marginTop: 12, gap: 10 }}>
                    <View style={{ flexDirection: "row", gap: 16, justifyContent: "center", alignItems: "center" }}>
                      <View style={{ width: 64 }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth
                          disabled={Boolean(uploadingById[c.id])}
                          onPress={() => {
                            handlePickMedia(c.id, "camera", "image");
                          }}
                        >
                          <Image
                            source={require("../../assets/camara.png")}
                            style={{ width: 22, height: 22, tintColor: theme.colors.textOnPrimary }}
                            resizeMode="contain"
                          />
                        </Button>
                      </View>
                      <View style={{ width: 64 }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth
                          disabled={Boolean(uploadingById[c.id])}
                          onPress={async () => {
                            await handlePickMedia(c.id, "gallery", "image");
                          }}
                        >
                          <Image
                            source={require("../../assets/galeria-de-imagenes.png")}
                            style={{ width: 22, height: 22, tintColor: theme.colors.textOnPrimary }}
                            resizeMode="contain"
                          />
                        </Button>
                      </View>
                    </View>

                    {uploadingById[c.id] ? <Muted>Subiendo reto...</Muted> : null}
                    {uploadErrorById[c.id] ? <Muted style={{ color: theme.colors.danger }}>{normalizeErrorMessage(uploadErrorById[c.id])}</Muted> : null}
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </View>

      <Card
        style={{
          marginTop: 6,
          borderColor: "rgba(60,140,255,0.35)",
          backgroundColor: "rgba(10,24,44,0.92)"
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <H2>Ranking</H2>
          <Pressable
            disabled={leadersRefreshing}
            onPress={handleRefreshLeaders}
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "rgba(140,200,255,0.55)",
              backgroundColor: pressed ? "rgba(140,200,255,0.22)" : "rgba(140,200,255,0.14)",
              alignItems: "center",
              justifyContent: "center",
              opacity: leadersRefreshing ? 0.6 : 1
            })}
          >
            {leadersRefreshing ? (
              <ActivityIndicator size="small" color={theme.colors.text} />
            ) : (
              <Muted style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>{"\u21bb"}</Muted>
            )}
          </Pressable>
        </View>
        <View style={{ height: 12 }} />
        {leaders.length === 0 ? (
          <Muted>Cargando ranking...</Muted>
        ) : (
          <View style={{ gap: 10 }}>
            {leaders.slice(0, 10).map((l, idx) => (
              <View
                key={`${l.nickname}-${idx}`}
                style={{
                  borderWidth: 1,
                  borderColor:
                    idx === 0
                      ? "rgba(255,214,102,0.75)"
                      : idx === 1
                        ? "rgba(190,205,224,0.7)"
                        : idx === 2
                          ? "rgba(255,176,120,0.7)"
                          : "rgba(90,140,190,0.35)",
                  borderRadius: 16,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  backgroundColor:
                    idx === 0
                      ? "rgba(255,214,102,0.18)"
                      : idx === 1
                        ? "rgba(190,205,224,0.16)"
                        : idx === 2
                          ? "rgba(255,176,120,0.16)"
                          : "rgba(16,34,64,0.85)",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      backgroundColor:
                        idx === 0
                          ? "rgba(255,214,102,0.95)"
                          : idx === 1
                            ? "rgba(190,205,224,0.95)"
                            : idx === 2
                              ? "rgba(255,176,120,0.95)"
                              : "rgba(255,255,255,0.12)",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    <Muted style={{ color: "#0b1220", fontWeight: "900" }}>{idx + 1}</Muted>
                  </View>
                  <Muted style={{ color: theme.colors.text, fontWeight: "900" }}>{l.nickname}</Muted>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Muted style={{ color: "rgba(140,200,255,0.9)", fontWeight: "700" }}>pts</Muted>
                  <Muted style={{ fontWeight: "900", fontSize: 16 }}>{l.points}</Muted>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
      <Modal
        transparent
        visible={adminOpen}
        animationType="fade"
        onRequestClose={() => {
          setAdminConfirm(null);
          setAdminOpen(false);
        }}
      >
        <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
          <Pressable
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" }}
            onPress={() => {
              if (!adminLoading) {
                setAdminConfirm(null);
                setAdminOpen(false);
              }
            }}
          />
          <Card>
            <Muted style={{ color: theme.colors.text, fontWeight: "900" }}>
              Opciones de la sala
            </Muted>
            <Muted style={{ marginTop: 6 }}>
              {isOwner
                ? "Puedes finalizar la partida o salir de la partida."
                : "Puedes salir de la partida. El resto seguira jugando."}
            </Muted>
            {adminError ? (
              <Muted style={{ marginTop: 10, color: theme.colors.danger }}>
                {normalizeErrorMessage(adminError)}
              </Muted>
            ) : null}
            <View style={{ marginTop: 12, gap: 10 }}>
              {isOwner ? (
                <>
                  {state !== "ended" ? (
                    <Button
                      variant="secondary"
                      disabled={adminLoading}
                      onPress={() => {
                        setAdminOpen(false);
                        setAdminConfirm({
                          action: "end",
                          title: "Finalizar partida?",
                          message: "Se marcara la partida como finalizada y se ira a la sala final.",
                          confirmLabel: "Finalizar partida",
                          confirmVariant: "secondary"
                        });
                      }}
                    >
                      {adminLoading ? "Finalizando..." : "Finalizar partida"}
                    </Button>
                  ) : null}
                  {leaders.length > 1 ? (
                    <Button
                      variant="danger"
                      disabled={adminLoading}
                      onPress={() => {
                        setAdminOpen(false);
                        setAdminConfirm({
                          action: "transfer",
                          title: "Salir de la partida?",
                          message: "El liderazgo se asignara a otro jugador y saldras de la partida.",
                          confirmLabel: "Salir",
                          confirmVariant: "danger"
                        });
                      }}
                    >
                      {adminLoading ? "Saliendo..." : "Salir de la partida"}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  variant="danger"
                  disabled={adminLoading}
                  onPress={() => {
                    setAdminOpen(false);
                    setAdminConfirm({
                      action: "leave",
                      title: "Salir de la partida?",
                      message: "Saldras de la sala, pero tus fotos y puntos se mantendran para el final.",
                      confirmLabel: "Salir",
                      confirmVariant: "danger"
                    });
                  }}
                >
                  {adminLoading ? "Saliendo..." : "Salir de la partida"}
                </Button>
              )}
              <Button
                variant="primary"
                disabled={adminLoading}
                onPress={() => {
                  setAdminConfirm(null);
                  setAdminOpen(false);
                }}
              >
                Volver
              </Button>
            </View>
          </Card>
        </View>
      </Modal>
      <Modal
        transparent
        visible={Boolean(adminConfirm)}
        animationType="fade"
        onRequestClose={() => {
          if (!adminLoading) {
            setAdminConfirm(null);
            setAdminOpen(true);
          }
        }}
      >
        <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
          <Pressable
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" }}
            onPress={() => {
              if (!adminLoading) {
                setAdminConfirm(null);
                setAdminOpen(true);
              }
            }}
          />
          <Card>
            <H2>{adminConfirm?.title ?? "Confirmar accion"}</H2>
            <Muted style={{ marginTop: 6 }}>{adminConfirm?.message ?? ""}</Muted>
            <View style={{ marginTop: 12, gap: 10 }}>
              <Button
                variant={adminConfirm?.confirmVariant ?? "danger"}
                disabled={adminLoading || !adminConfirm}
                onPress={handleAdminConfirm}
              >
                {adminLoading
                  ? adminConfirm?.action === "end"
                    ? "Finalizando..."
                    : "Saliendo..."
                  : adminConfirm?.confirmLabel ?? "Confirmar"}
              </Button>
              <Button
                variant="secondary"
                disabled={adminLoading}
                onPress={() => {
                  setAdminConfirm(null);
                  setAdminOpen(true);
                }}
              >
                Cancelar
              </Button>
            </View>
          </Card>
        </View>
      </Modal>

      <Modal transparent visible={Boolean(confirmDeleteId)} animationType="fade" onRequestClose={() => setConfirmDeleteId(null)}>
        <View style={{ flex: 1, padding: 18, justifyContent: "center" }}>
          <Pressable
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" }}
            onPress={() => setConfirmDeleteId(null)}
          />
          <View
            style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "rgba(26,28,58,0.95)", padding: 14 }}
          >
            <H2>Eliminar media</H2>
            <Muted style={{ marginTop: 6 }}>Se borrará el archivo y se quitará el punto.</Muted>
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setConfirmDeleteId(null);
                  }}
                >
                  Cancelar
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  variant="danger"
                  disabled={!confirmDeleteId}
                  onPress={async () => {
                    const id = confirmDeleteId;
                    setConfirmDeleteId(null);
                    if (id) await handleDeleteMedia(id);
                  }}
                >
                  Eliminar
                </Button>
              </View>
            </View>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={Boolean(previewMedia)} animationType="fade" onRequestClose={() => setPreviewMedia(null)}>
        <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
          <Pressable
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.75)" }}
            onPress={() => setPreviewMedia(null)}
          />
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "rgba(0,0,0,0.85)", padding: 10 }}>
            <Pressable
              onPress={() => setPreviewMedia(null)}
              style={{ position: "absolute", right: 10, top: 10, zIndex: 2, padding: 6 }}
            >
              <Muted style={{ fontWeight: "900", fontSize: 18 }}>X</Muted>
            </Pressable>
            {previewMedia ? (
              previewMedia.type === "video" ? (
                <VideoPreview url={previewMedia.url} />
              ) : (
                <Image
                  source={{ uri: previewMedia.url }}
                  style={{ width: "100%", height: 420, borderRadius: 12 }}
                  resizeMode="contain"
                />
              )
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal transparent visible={Boolean(uploadProgress)} animationType="fade" onRequestClose={() => {}}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", padding: 18, justifyContent: "center" }}>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "rgba(26,28,58,0.95)", padding: 14 }}>
            <H2>{uploadProgress?.mode === "delete" ? "Eliminando foto" : "Subiendo reto"}</H2>
            <View style={{ height: 12 }} />
            <ActivityIndicator color={theme.colors.text} />
            <View style={{ height: 12 }} />
            {uploadProgress?.mode === "delete" ? (
              <Muted style={{ marginTop: 2, textAlign: "center" }}>Eliminando...</Muted>
            ) : (
              <>
                <View style={{ height: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                  <View
                    style={{
                      height: 8,
                      width: `${uploadProgress?.pct ?? 0}%`,
                      backgroundColor: theme.colors.buttonSecondary
                    }}
                  />
                </View>
                <Muted style={{ marginTop: 8, textAlign: "center" }}>{uploadProgress?.pct ?? 0}%</Muted>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}







