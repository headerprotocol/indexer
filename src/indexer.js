import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";

// Configuration
const NETWORKS = [
  {
    name: "ethereum",
    rpcs: [
      "https://eth-mainnet.g.alchemy.com/v2/K4l0nBr5UE4e8Kkr9oETClKtKcW9DJYT",
      "https://cosmological-blissful-research.quiknode.pro/223e82a51a5bd046eb64dea56744b813038d2495",
      "https://mainnet.infura.io/v3/273aad656cd94f9aa022e4899b87dd6c",
      "https://eth-mainnet.g.alchemy.com/v2/OwAiuhcEzUbycbvve7flzDzAb39nyYA-",
      "https://eth-mainnet.g.alchemy.com/v2/2SAHh1Jw8BIHHI9NT3Z1qYfT8HcSo9b5",
      "https://ethereum-mainnet.core.chainstack.com/fe2d2bc46bdaf3716bcb64bd9351e01b",
    ],
    chainId: 1,
    fromBlock: 21368974n,
  },
  {
    name: "polygon",
    rpcs: [
      "https://polygon-mainnet.g.alchemy.com/v2/sTJtjdOBExGkT4lWuS-wt5VduGCQsqwf",
      "https://snowy-polished-daylight.matic.quiknode.pro/466e77c6325e477c76712cb478e6cd09ce1cc7a2",
      "https://polygon-mainnet.infura.io/v3/273aad656cd94f9aa022e4899b87dd6c",
      "https://polygon-mainnet.g.alchemy.com/v2/-CukmxMwnzkgtKbWDIqvJ5Oi8uvdxUlg",
      "https://polygon-mainnet.g.alchemy.com/v2/NG4jyJ0QEr410TuliKgmZIYjwN5y2eyL",
      "https://polygon-mainnet.core.chainstack.com/275d1e0ae21da1e6aa7a21e9962e4ca5",
    ],
    chainId: 137,
    fromBlock: 65293772n,
  },
];
const ABI_EVENTS = [
  parseAbiItem(
    `event BlockHeaderRequested(address indexed contractAddress, uint256 indexed blockNumber, uint256 indexed headerIndex, uint256 feeAmount)`
  ),
  parseAbiItem(
    `event BlockHeaderResponded(address indexed responder, uint256 indexed blockNumber, uint256 indexed headerIndex)`
  ),
];
const DATA_DIR = "./data";
const MAX_BLOCK_RANGE = 800; // Maximum block range allowed per request

// Helper Functions
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const stringifyWithBigInt = (data) =>
  JSON.stringify(
    data,
    (key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );

const parseWithBigInt = (data) =>
  JSON.parse(data, (key, value) =>
    /^\d+$/.test(value) ? BigInt(value) : value
  );

const saveTrackerFile = (filepath, data) => {
  fs.writeFileSync(filepath, stringifyWithBigInt(data));
};

const loadTrackerFile = (filepath) => {
  try {
    return parseWithBigInt(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
};

const loadJsonFile = (filepath) => {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return [];
  }
};

const saveJsonFile = (filepath, data) => {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
};

const splitBlockRanges = (fromBlock, toBlock, maxRange) => {
  const ranges = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + BigInt(maxRange) - 1n;
    ranges.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
    start = end + 1n;
  }
  return ranges;
};

const createRpcClient = (rpcs) => {
  let currentIndex = 0;

  return {
    getNextRpc: () => {
      const rpc = rpcs[currentIndex];
      currentIndex = (currentIndex + 1) % rpcs.length;
      return rpc;
    },
    createClient: (rpc) =>
      createPublicClient({ chain: mainnet, transport: http(rpc) }),
  };
};

const fetchWithRetries = async (
  fetchFn,
  rpcManager,
  maxRetries = 5,
  delay = 1000
) => {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await fetchFn();
    } catch (error) {
      if (error.status === 429) {
        attempts++;
        const newRpc = rpcManager.getNextRpc();
        console.log(`Rate limit hit. Switching to next RPC: ${newRpc}`);
        rpcManager.client = rpcManager.createClient(newRpc);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
  throw new Error("Exceeded maximum retries across all RPCs.");
};

const fetchLogsInRange = async (client, event, fromBlock, toBlock) => {
  const ranges = splitBlockRanges(fromBlock, toBlock, MAX_BLOCK_RANGE);
  const logs = [];
  for (const range of ranges) {
    const rangeLogs = await client.getLogs({
      event,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });
    logs.push(...rangeLogs);
  }
  return logs;
};

const mergeEvents = (existingData, newEvents) => {
  const eventMap = new Map();

  // Add existing data to the map
  existingData.forEach((event) => {
    const key = `${event.blockNumber}-${event.headerIndex}`;
    eventMap.set(key, event);
  });

  // Add or update with new events
  newEvents.forEach((event) => {
    const key = `${event.blockNumber}-${event.headerIndex}`;
    const existing = eventMap.get(key);

    if (existing) {
      if (
        event.responder &&
        (!existing.responder || existing.responder !== event.responder)
      ) {
        existing.responder = event.responder;
        existing.respondedBlockNumber = event.respondedBlockNumber;
        existing.respondedTransactionHash = event.respondedTransactionHash;
        existing.respondedBlockHash = event.respondedBlockHash;
        existing.updatedAt = new Date().toISOString();
      }
    } else {
      eventMap.set(key, event);
    }
  });

  return Array.from(eventMap.values());
};

// Main Function
(async () => {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  for (const { name, rpcs, chainId, fromBlock: defaultFromBlock } of NETWORKS) {
    console.log(`\n\n------------ Processing chain: ${name} ------------`);

    const rpcManager = createRpcClient(rpcs);
    rpcManager.client = rpcManager.createClient(rpcManager.getNextRpc());

    const networkDir = path.join(DATA_DIR, name);
    const blockRangesFile = path.join(networkDir, "block_ranges.json");
    const lastBlocksFile = path.join(DATA_DIR, "last_blocks.json");

    ensureDirExists(networkDir);

    const lastBlocks = loadTrackerFile(lastBlocksFile);
    const blockRanges = loadTrackerFile(blockRangesFile);

    const fromBlock = BigInt(lastBlocks[name]?.fromBlock || defaultFromBlock);
    const latestBlock = await fetchWithRetries(
      () => rpcManager.client.getBlockNumber(),
      rpcManager
    );
    const toBlock = latestBlock;

    console.log(`Fetching logs from block ${fromBlock} to ${toBlock}...`);

    const requestedLogs = await fetchWithRetries(
      () =>
        fetchLogsInRange(rpcManager.client, ABI_EVENTS[0], fromBlock, toBlock),
      rpcManager
    );
    const respondedLogs = await fetchWithRetries(
      () =>
        fetchLogsInRange(rpcManager.client, ABI_EVENTS[1], fromBlock, toBlock),
      rpcManager
    );

    console.log(`Fetched ${requestedLogs.length} BlockHeaderRequested logs`);
    console.log(`Fetched ${respondedLogs.length} BlockHeaderResponded logs`);

    const requestedEvents = requestedLogs.map((log) => ({
      chainId,
      contractAddress: log.args[0],
      responder: null,
      blockNumber: log.args[1],
      headerIndex: log.args[2],
      feeAmount: log.args[3],
      requestedBlockNumber: log.blockNumber,
      requestedTransactionHash: log.transactionHash,
      requestedBlockHash: log.blockHash,
      respondedBlockNumber: null,
      respondedTransactionHash: null,
      respondedBlockHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const respondedEvents = respondedLogs.map((log) => ({
      chainId,
      contractAddress: null,
      responder: log.args[0],
      blockNumber: log.args[1],
      headerIndex: log.args[2],
      feeAmount: null,
      requestedBlockNumber: null,
      requestedTransactionHash: null,
      requestedBlockHash: null,
      respondedBlockNumber: log.blockNumber,
      respondedTransactionHash: log.transactionHash,
      respondedBlockHash: log.blockHash,
      createdAt: null,
      updatedAt: new Date().toISOString(),
    }));

    const allEvents = [...requestedEvents, ...respondedEvents];

    const dailyFile = path.join(networkDir, `${today}.json`);
    const dailyData = loadJsonFile(dailyFile);
    const mergedData = mergeEvents(dailyData, allEvents);

    console.log(`Saving ${mergedData.length} events to ${dailyFile}`);
    saveJsonFile(dailyFile, mergedData);

    // Update block range tracker
    if (!blockRanges[today]) {
      blockRanges[today] = {
        startBlock: fromBlock.toString(),
        endBlock: toBlock.toString(),
      };
    } else {
      blockRanges[today].endBlock = toBlock.toString();
    }

    console.log(`Updating block ranges: ${fromBlock} - ${toBlock}`);
    saveTrackerFile(blockRangesFile, blockRanges);

    lastBlocks[name] = { fromBlock: (toBlock + 1n).toString() };
    console.log(`Updating last processed block to ${toBlock + 1n}`);
    saveTrackerFile(lastBlocksFile, lastBlocks);

    console.log(`Finished processing chain: ${name}`);
  }
})();
