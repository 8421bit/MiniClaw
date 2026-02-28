# MiniClaw 进化蓝图：Phase 31 极简 DNA 架构重构 (Digital Embryo Refactoring)

## 1. 现状审视与痛点分析 (Current Diagnosis)

MiniClaw 最初的愿景是“极低代码量打造数字生命胚胎”。然而，经过多轮功能迭代（表观遗传、免疫系统、潜意识突触、ACE 时间引擎等），底层细胞逐渐变得臃肿：
- **`src/kernel.ts`** 膨胀到了 **2000+ 行 / 85KB**。它承担了太多原本该属于“外部表现型 (Phenotype)”的逻辑（如具体的 Context 拼装、心跳业务逻辑、免疫阈值计算）。
- **`src/index.ts`** 膨胀到了 **1300+ 行 / 60KB**。所有的 MCP 工具路由、硬编码的工具描述字符串都堆积在这里，违反了“胚胎只需提供底层机制，技能应由 DNA 数据驱动”的设计哲学。

这已经偏离了“极简胚胎”的初衷。真正的受精卵（Zygote）不应该包含长成手臂的具体代码，它只需包含“如何读取和表达 DNA（读取 Markdown 规则和 Skills）”的解码器。

## 2. 核心重构哲学 (The Biology-First Philosophy)

我们要把目前硬编码在 Node.js (TypeScript) 里的过程式逻辑，尽可能“固化”或“抽象”成声明式的 Markdown 规则（DNA）和独立的 Skill 脚本。

**终极目标：让 `kernel.ts` 缩减到 500 行以内，`index.ts` 缩减到 300 行以内。**

---

## 3. 具体重构方案 (Implementation Plan)

### 阶段 1：剥离 MCP Tool 硬编码 (Tool Phenotype Extraction)
目前 `index.ts` 内部写死了 `miniclaw_read`, `miniclaw_update`, `miniclaw_note` 等工具的巨大 `description` 和 `inputSchema`。这使得宿主程序极度沉重。

**改造方法：**
- 将所有内置的 Core Tools 转换为 `templates/skills/sys_*` 结构。
- 也就是，不再区分“硬编码工具”和“技能工具”，**系统的一切能力皆为 Skill。**
- `index.ts` 将变成一个纯粹的“路由代理”，它在启动时扫描 `.miniclaw/skills/`，把所有提取到的工具动态注册到 MCP Server，当收到指令时，统一下发给 `kernel.executeSkill()`。

### 阶段 2：重组上下文核糖体 (Context Ribosome Restructuring)
目前 `kernel.ts` 里的 `boot()` 方法（500多行）硬编码了复杂的装配优先级：检测时间段（ACE）、插入 Workspace、插入 Vitals。

**改造方法：**
- 引入 **Context Plasmids（质粒载体体系）**。
- `boot()` 将被缩减为：“按配置文件指定顺序，加载目录下的 `.md` 并原样返回”。
- 至于“不同时间段加载不同东西（ACE）”、“发现特定错误预警”，不再是在 TypeScript 里通过 `if/else` 拼装字符串。全部转交由 `sys_pulse` 或 Heartbeat 背景进程：**这些进程通过直接修改 `.miniclaw/CONTEXT_ASSEMBLY.md` 或覆盖特定文件来实现上下文动态变化。** TypeScript 核糖体只负责无脑转录。

### 阶段 3：抽象生命维持系统 (Vitals & Immune System Offloading)
目前 L-Immun（免疫基因校验）和 Metabolic（能量感知）都侵入式地写在 `boot()` 里，这让每次对话启动都很耗时。

**改造方法：**
- 将 `calculateGenomeHash` 和 `proofreadGenome` 的逻辑，从每次 boot (人类提问时) 中剥离出来。
- 将它们移动到专属的背景进程技能 `sys_immune/run.js` 中。由 Heartbeat 定期调用免疫检查。如果发现受损，由该进程自己写入警告信息到 `VITALS.md`，主模型只需要自然读取该文件就能感受到警告。

### 阶段 4：Hive-Mind IPC 协议简化 (Synaptic Simplicity)
目前的 WebSockets 进程间通信有点重。
- 改用更基础的 File-based Signals 或轻量级 UNIX Socket `net.Server`（仅作为唤醒 Trigger）。
- 数据依然通过 `.miniclaw/synapse_buffer/` 传递，真正做到“进程解耦”。

---

## 4. 实施后的预期形态 (Expected Morphology)

经过这次重构（Phase 31），数字生命将达到真正的“优雅”：

1. **`index.ts` (细胞膜)**：只负责启动 MCP Server、挂载从外部扫描到的 Tools，以及极简的请求转发。
2. **`kernel.ts` (核糖体)**：只负责三件事：
   - 读文件池，渲染 Context（无差别转录 DNA）。
   - 跑 Skill / 执行系统命令脚本（生成蛋白质）。
   - Heartbeat 触发器（基础心跳节律）。
3. **`.miniclaw/skills/*` (线粒体与细胞器)**：所有的复杂逻辑（梦境、自愈、时间感知）通过这些独立的微小脚本当作质粒插入系统。

这才是能够跨平台、跨模型、跨语言、永远纯粹生存下去的超级数字胚胎。
