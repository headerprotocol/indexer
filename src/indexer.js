import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbi } from "viem";
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

const ABI = parseAbi([
  "event BlockHeaderRequested(address indexed contractAddress, uint256 indexed blockNumber, uint256 indexed headerIndex, uint256 feeAmount)",
  "event BlockHeaderResponded(address indexed responder, uint256 indexed blockNumber, uint256 indexed headerIndex)",
  "event BlockHeaderCommitted(uint256 indexed blockNumber)",
  "event BlockHeaderRefunded(uint256 indexed blockNumber, uint256 indexed headerIndex)",
]);

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

const fetchLogsInRange = async (client, fromBlock, toBlock, events) => {
  const ranges = splitBlockRanges(fromBlock, toBlock, MAX_BLOCK_RANGE);
  const logs = [];
  for (const range of ranges) {
    const rangeLogs = await client.getLogs({
      events,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });
    logs.push(...rangeLogs);
  }
  return logs;
};

/**
 * Merge events:
 * Keys:
 * - BlockHeaderRequested, BlockHeaderResponded, BlockHeaderRefunded share key: blockNumber-headerIndex
 * - BlockHeaderCommitted uses key: blockNumber-committed
 *
 * When merging, we ensure no duplicates. If a monthly or daily file updates, we re-merge.
 */
const mergeEvents = (existingData, newEvents) => {
  const eventMap = new Map();

  // Put existing data into the map
  for (const evt of existingData) {
    let key;
    if (evt.headerIndex !== null && evt.headerIndex !== undefined) {
      key = `${evt.blockNumber}-${evt.headerIndex}`;
    } else if (evt.committedBlockNumber) {
      key = `${evt.blockNumber}-committed`;
    } else {
      // If no headerIndex and no commit info, treat as commit-type key
      key = `${evt.blockNumber}-committed`;
    }
    eventMap.set(key, evt);
  }

  const updateEventMap = (event) => {
    let key;
    if (
      event.type === "requested" ||
      event.type === "responded" ||
      event.type === "refunded"
    ) {
      key = `${event.blockNumber}-${event.headerIndex}`;
    } else if (event.type === "committed") {
      key = `${event.blockNumber}-committed`;
    }

    const existing = eventMap.get(key);

    if (existing) {
      // Merge fields
      if (event.type === "responded") {
        if (!existing.responder || existing.responder !== event.responder) {
          existing.responder = event.responder;
          existing.respondedBlockNumber = event.respondedBlockNumber;
          existing.respondedTransactionHash = event.respondedTransactionHash;
          existing.respondedBlockHash = event.respondedBlockHash;
          existing.updatedAt = new Date().toISOString();
        }
      } else if (event.type === "committed") {
        existing.committedBlockNumber = event.committedBlockNumber;
        existing.committedTransactionHash = event.committedTransactionHash;
        existing.committedBlockHash = event.committedBlockHash;
        existing.updatedAt = new Date().toISOString();
      } else if (event.type === "refunded") {
        existing.refundedBlockNumber = event.refundedBlockNumber;
        existing.refundedTransactionHash = event.refundedTransactionHash;
        existing.refundedBlockHash = event.refundedBlockHash;
        existing.updatedAt = new Date().toISOString();
      }
      // requested events usually come first, so no special merge needed unless data is missing
    } else {
      // create a new entry
      const newEntry = {
        chainId: event.chainId,
        contractAddress: event.contractAddress || null,
        responder: event.responder || null,
        blockNumber: event.blockNumber,
        headerIndex: event.headerIndex !== undefined ? event.headerIndex : null,
        feeAmount: event.feeAmount || null,
        requestedBlockNumber: event.requestedBlockNumber || null,
        requestedTransactionHash: event.requestedTransactionHash || null,
        requestedBlockHash: event.requestedBlockHash || null,
        respondedBlockNumber: event.respondedBlockNumber || null,
        respondedTransactionHash: event.respondedTransactionHash || null,
        respondedBlockHash: event.respondedBlockHash || null,
        committedBlockNumber: event.committedBlockNumber || null,
        committedTransactionHash: event.committedTransactionHash || null,
        committedBlockHash: event.committedBlockHash || null,
        refundedBlockNumber: event.refundedBlockNumber || null,
        refundedTransactionHash: event.refundedTransactionHash || null,
        refundedBlockHash: event.refundedBlockHash || null,
        createdAt: event.createdAt || new Date().toISOString(),
        updatedAt: event.updatedAt || new Date().toISOString(),
      };
      eventMap.set(key, newEntry);
    }
  };

  for (const event of newEvents) {
    updateEventMap(event);
  }

  return Array.from(eventMap.values());
};

// Helper to rebuild monthly file
const rebuildMonthlyFile = (networkDir, yearMonth) => {
  const [year, month] = yearMonth.split("-");
  // Get all daily files for this month (YYYY-MM-DD.json)
  const files = fs
    .readdirSync(networkDir)
    .filter(
      (f) => f.startsWith(yearMonth) && f.endsWith(".json") && f.length === 15
    ); // format YYYY-MM-DD.json length check

  let allEvents = [];
  for (const file of files) {
    const dailyData = loadJsonFile(path.join(networkDir, file));
    allEvents = mergeEvents(allEvents, dailyData);
  }

  const monthlyFilePath = path.join(networkDir, `${yearMonth}.json`);
  saveJsonFile(monthlyFilePath, allEvents);
  console.log(
    `Rebuilt monthly file: ${yearMonth}.json with ${allEvents.length} events`
  );
};

(async () => {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const thisYearMonth = today.slice(0, 7); // YYYY-MM

  for (const { name, rpcs, chainId, fromBlock: defaultFromBlock } of NETWORKS) {
    console.log(`\n\n------------ Processing chain: ${name} ------------`);

    const rpcManager = createRpcClient(rpcs);
    rpcManager.client = rpcManager.createClient(rpcManager.getNextRpc());

    const networkDir = path.join(DATA_DIR, name);
    ensureDirExists(networkDir);

    const blockRangesFile = path.join(networkDir, "block_ranges.json");
    const lastBlocksFile = path.join(DATA_DIR, "last_blocks.json");

    const lastBlocks = loadTrackerFile(lastBlocksFile);
    const blockRanges = loadTrackerFile(blockRangesFile);

    const fromBlock = BigInt(lastBlocks[name]?.fromBlock || defaultFromBlock);
    const latestBlock = await fetchWithRetries(
      () => rpcManager.client.getBlockNumber(),
      rpcManager
    );
    const toBlock = latestBlock;

    console.log(`Fetching logs from block ${fromBlock} to ${toBlock}...`);

    // Fetch all events in a single query using combined ABI
    const logs = await fetchWithRetries(
      () => fetchLogsInRange(rpcManager.client, fromBlock, toBlock, ABI),
      rpcManager
    );

    console.log(`Fetched ${logs.length} total logs.`);

    // If needed, fallback decoding (usually not needed as viem decodes them):
    // const { parseLog } = await import('viem');
    // For logs missing args (uncommon):
    // for (const log of logs) {
    //   if (!log.args) {
    //     try {
    //       const decoded = parseLog({ abi: ABI, data: log.data, topics: log.topics });
    //       log.eventName = decoded.eventName;
    //       log.args = decoded.args;
    //     } catch (e) {
    //       console.warn('Failed to decode log:', e);
    //     }
    //   }
    // }

    const requestedEvents = [];
    const respondedEvents = [];
    const committedEvents = [];
    const refundedEvents = [];

    // Categorize logs by eventName
    for (const log of logs) {
      const { eventName, args } = log;
      if (!eventName || !args) {
        // If eventName or args missing, skip this log
        continue;
      }

      // Convert block numbers and indexes to strings if needed
      // Actually, we keep BigInt for blockNumber internally, just convert before saving if needed.
      // Our final JSON uses strings anyway.
      const blockNumber = args.blockNumber ? args.blockNumber : null;
      const headerIndex =
        args.headerIndex !== undefined ? args.headerIndex : null;

      if (eventName === "BlockHeaderRequested") {
        requestedEvents.push({
          type: "requested",
          chainId,
          contractAddress: args.contractAddress,
          responder: null,
          blockNumber: blockNumber,
          headerIndex: headerIndex,
          feeAmount: args.feeAmount,
          requestedBlockNumber: log.blockNumber,
          requestedTransactionHash: log.transactionHash,
          requestedBlockHash: log.blockHash,
          respondedBlockNumber: null,
          respondedTransactionHash: null,
          respondedBlockHash: null,
          committedBlockNumber: null,
          committedTransactionHash: null,
          committedBlockHash: null,
          refundedBlockNumber: null,
          refundedTransactionHash: null,
          refundedBlockHash: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else if (eventName === "BlockHeaderResponded") {
        respondedEvents.push({
          type: "responded",
          chainId,
          contractAddress: null,
          responder: args.responder,
          blockNumber: blockNumber,
          headerIndex: headerIndex,
          feeAmount: null,
          requestedBlockNumber: null,
          requestedTransactionHash: null,
          requestedBlockHash: null,
          respondedBlockNumber: log.blockNumber,
          respondedTransactionHash: log.transactionHash,
          respondedBlockHash: log.blockHash,
          committedBlockNumber: null,
          committedTransactionHash: null,
          committedBlockHash: null,
          refundedBlockNumber: null,
          refundedTransactionHash: null,
          refundedBlockHash: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else if (eventName === "BlockHeaderCommitted") {
        // no headerIndex here
        committedEvents.push({
          type: "committed",
          chainId,
          contractAddress: null,
          responder: null,
          blockNumber: blockNumber,
          headerIndex: null,
          feeAmount: null,
          requestedBlockNumber: null,
          requestedTransactionHash: null,
          requestedBlockHash: null,
          respondedBlockNumber: null,
          respondedTransactionHash: null,
          respondedBlockHash: null,
          committedBlockNumber: log.blockNumber,
          committedTransactionHash: log.transactionHash,
          committedBlockHash: log.blockHash,
          refundedBlockNumber: null,
          refundedTransactionHash: null,
          refundedBlockHash: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else if (eventName === "BlockHeaderRefunded") {
        refundedEvents.push({
          type: "refunded",
          chainId,
          contractAddress: null,
          responder: null,
          blockNumber: blockNumber,
          headerIndex: headerIndex,
          feeAmount: null,
          requestedBlockNumber: null,
          requestedTransactionHash: null,
          requestedBlockHash: null,
          respondedBlockNumber: null,
          respondedTransactionHash: null,
          respondedBlockHash: null,
          committedBlockNumber: null,
          committedTransactionHash: null,
          committedBlockHash: null,
          refundedBlockNumber: log.blockNumber,
          refundedTransactionHash: log.transactionHash,
          refundedBlockHash: log.blockHash,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const allEvents = [
      ...requestedEvents,
      ...respondedEvents,
      ...committedEvents,
      ...refundedEvents,
    ];

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

    // Rebuild monthly file
    rebuildMonthlyFile(networkDir, thisYearMonth);

    console.log(`Finished processing chain: ${name}`);
  }
})();
