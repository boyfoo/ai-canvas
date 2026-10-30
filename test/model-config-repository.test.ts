import { describe, expect, it } from "bun:test";
import { createModelConfigRepository } from "../src/services/model-config-repository";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";

describe("本地模型配置保存", () => {
    it("读取完成前不保存；读取失败后也不会用默认配置覆盖现有内容", async () => {
        let writes = 0;
        let failRead = true;
        const repository = createModelConfigRepository({
            read: async () => {
                if (failRead) throw new Error("storage unavailable");
                return { config: defaultConfig, revision: 7, health: "ready", source: "browser" };
            },
            write: async (_, revision) => { writes++; return { saved: true, revision: revision + 1 }; },
        });
        const pending = repository.commit(defaultConfig);
        await expect(repository.hydrate()).rejects.toThrow("storage unavailable");
        expect(writes).toBe(0);
        expect(repository.getState().status).toBe("error");
        failRead = false;
        await repository.hydrate();
        await pending;
        expect(writes).toBe(1);
        expect(repository.getState()).toMatchObject({ revision: 8, status: "saved", dirty: false });
    });

    it("删除最后一个渠道也会持久化，失败时保留修改以供重试", async () => {
        let failWrite = true;
        let saved: AiConfig | undefined;
        const repository = createModelConfigRepository({
            read: async () => ({ config: defaultConfig, revision: 1, health: "ready", source: "browser" }),
            write: async (config, revision) => {
                if (failWrite) throw new Error("disk full");
                saved = config;
                return { saved: true, revision: revision + 1 };
            },
        });
        await repository.hydrate();
        await repository.commit({ ...defaultConfig, channels: [] });
        expect(repository.getState()).toMatchObject({ status: "error", dirty: true, error: "disk full" });
        failWrite = false;
        await repository.flush();
        expect(saved?.channels).toEqual([]);
        expect(repository.getState()).toMatchObject({ status: "saved", dirty: false, revision: 2 });
    });
});
