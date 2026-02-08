import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { subscribeErrorModal } from "../lib/errorModal";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { H2, Muted } from "../ui/Text";
import { theme } from "../ui/theme";

type QueueItem = {
  title: string;
  message: string;
};

export function GlobalErrorModal() {
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    return subscribeErrorModal((payload) => {
      setQueue((prev) => [...prev, payload]);
    });
  }, []);

  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((prev) => prev.slice(1));
  }, [current, queue]);

  const close = () => setCurrent(null);

  return (
    <Modal transparent visible={Boolean(current)} animationType="fade" onRequestClose={close}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" }}
        onPress={close}
      >
        <Pressable onPress={() => {}} style={{ width: "100%" }}>
          <Card style={{ backgroundColor: theme.colors.card, borderColor: theme.colors.buttonPrimaryBorder }}>
            <H2 style={{ fontSize: 20 }}>{current?.title ?? "Aviso"}</H2>
            <Muted style={{ marginTop: 8 }}>{current?.message ?? ""}</Muted>
            <View style={{ marginTop: 14 }}>
              <Button variant="secondary" onPress={close}>
                Entendido
              </Button>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
