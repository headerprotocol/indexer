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

// Parse ABI for events
const ABI_EVENTS = [
  parseAbiItem(
    `event BlockHeaderRequested(address indexed contractAddress, uint256 indexed blockNumber, uint256 indexed headerIndex, uint256 feeAmount)`
  ),
  parseAbiItem(
    `event BlockHeaderResponded(address indexed responder, uint256 indexed blockNumber, uint256 indexed headerIndex)`
  ),
  parseAbiItem(`event BlockHeaderCommitted(uint256 indexed blockNumber)`),
  parseAbiItem(
    `event BlockHeaderRefunded(uint256 indexed blockNumber, uint256 indexed headerIndex)`
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
  // We'll map events by a composite key depending on event type:
  // For requested/responded/refunded: key = `${blockNumber}-${headerIndex}`
  // For committed: key = `${blockNumber}-committed`
  const eventMap = new Map();

  // Put existing data into the map
  for (const evt of existingData) {
    let key;
    if (evt.headerIndex !== null && evt.headerIndex !== undefined) {
      key = `${evt.blockNumber}-${evt.headerIndex}`;
    } else if (evt.committedBlockNumber !== null) {
      // This entry might have come from a commit-only event.
      key = `${evt.blockNumber}-committed`;
    } else {
      // If no headerIndex and not a commit event, treat as committed-type key
      key = `${evt.blockNumber}-committed`;
    }
    eventMap.set(key, evt);
  }

  // Function to update or create events in the map
  const updateEventMap = (event) => {
    let key;
    if (
      event.type === "requested" ||
      event.type === "responded" ||
      event.type === "refunded"
    ) {
      key = `${event.blockNumber}-${event.headerIndex}`;
    } else if (event.type === "committed") {
      // For committed events, we might need to update all events with the same blockNumber
      // or create a new one if none exist
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
        // Add commit info to the existing event
        existing.committedBlockNumber = event.committedBlockNumber;
        existing.committedTransactionHash = event.committedTransactionHash;
        existing.committedBlockHash = event.committedBlockHash;
        existing.updatedAt = new Date().toISOString();
      } else if (event.type === "refunded") {
        // Add refund info to the existing event
        existing.refundedBlockNumber = event.refundedBlockNumber;
        existing.refundedTransactionHash = event.refundedTransactionHash;
        existing.refundedBlockHash = event.refundedBlockHash;
        existing.updatedAt = new Date().toISOString();
      } else if (event.type === "requested") {
        // If requested event for same key, just ensure fields are correct
        // Typically requested events won't overwrite anything since they're the initial record
      }
    } else {
      // No existing entry
      // For committed events, we need to apply commit info to all events with the same blockNumber if they exist
      // If none exists for that blockNumber, create a new "commit-only" entry
      if (event.type === "committed") {
        // Check if there are entries with the same blockNumber but different headerIndex
        let found = false;
        for (const [k, v] of eventMap.entries()) {
          const parts = k.split("-");
          const bn = parts[0];
          if (bn === event.blockNumber.toString() && parts[1] !== "committed") {
            // Update these events with commit info
            v.committedBlockNumber = event.committedBlockNumber;
            v.committedTransactionHash = event.committedTransactionHash;
            v.committedBlockHash = event.committedBlockHash;
            v.updatedAt = new Date().toISOString();
            found = true;
          }
        }

        if (!found) {
          // Create a new commit-only entry
          eventMap.set(key, {
            chainId: event.chainId,
            contractAddress: null,
            responder: null,
            blockNumber: event.blockNumber,
            headerIndex: null,
            feeAmount: null,
            requestedBlockNumber: null,
            requestedTransactionHash: null,
            requestedBlockHash: null,
            respondedBlockNumber: null,
            respondedTransactionHash: null,
            respondedBlockHash: null,
            committedBlockNumber: event.committedBlockNumber,
            committedTransactionHash: event.committedTransactionHash,
            committedBlockHash: event.committedBlockHash,
            refundedBlockNumber: null,
            refundedTransactionHash: null,
            refundedBlockHash: null,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
          });
        }
      } else {
        // For requested, responded, refunded:
        // If it's responded or refunded without a requested event, create a skeleton entry
        const newEntry = {
          chainId: event.chainId,
          contractAddress: event.contractAddress || null,
          responder: event.responder || null,
          blockNumber: event.blockNumber,
          headerIndex:
            event.headerIndex !== undefined ? event.headerIndex : null,
          feeAmount: event.feeAmount || null,
          requestedBlockNumber: event.requestedBlockNumber || null,
          requestedTransactionHash: event.requestedTransactionHash || null,
          requestedBlockHash: event.requestedBlockHash || null,
          respondedBlockNumber: event.respondedBlockNumber || null,
          respondedTransactionHash: event.respondedTransactionHash || null,
          respondedBlockHash: event.respondedBlockHash || null,
          committedBlockNumber: null,
          committedTransactionHash: null,
          committedBlockHash: null,
          refundedBlockNumber: event.refundedBlockNumber || null,
          refundedTransactionHash: event.refundedTransactionHash || null,
          refundedBlockHash: event.refundedBlockHash || null,
          createdAt: event.createdAt || new Date().toISOString(),
          updatedAt: event.updatedAt || new Date().toISOString(),
        };
        eventMap.set(key, newEntry);
      }
    }
  };

  // Add or update with new events
  for (const event of newEvents) {
    updateEventMap(event);
  }

  return Array.from(eventMap.values());
};

const createBaseEventObject = (chainId, blockNumber, headerIndex = null) => ({
  chainId,
  contractAddress: null,
  responder: null,
  blockNumber,
  headerIndex,
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
  refundedBlockNumber: null,
  refundedTransactionHash: null,
  refundedBlockHash: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

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

    // Fetch all events
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
    const committedLogs = await fetchWithRetries(
      () =>
        fetchLogsInRange(rpcManager.client, ABI_EVENTS[2], fromBlock, toBlock),
      rpcManager
    );
    const refundedLogs = await fetchWithRetries(
      () =>
        fetchLogsInRange(rpcManager.client, ABI_EVENTS[3], fromBlock, toBlock),
      rpcManager
    );

    console.log(`Fetched ${requestedLogs.length} BlockHeaderRequested logs`);
    console.log(`Fetched ${respondedLogs.length} BlockHeaderResponded logs`);
    console.log(`Fetched ${committedLogs.length} BlockHeaderCommitted logs`);
    console.log(`Fetched ${refundedLogs.length} BlockHeaderRefunded logs`);

    const requestedEvents = requestedLogs.map((log) => ({
      type: "requested",
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
      committedBlockNumber: null,
      committedTransactionHash: null,
      committedBlockHash: null,
      refundedBlockNumber: null,
      refundedTransactionHash: null,
      refundedBlockHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const respondedEvents = respondedLogs.map((log) => ({
      type: "responded",
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
      committedBlockNumber: null,
      committedTransactionHash: null,
      committedBlockHash: null,
      refundedBlockNumber: null,
      refundedTransactionHash: null,
      refundedBlockHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const committedEvents = committedLogs.map((log) => ({
      type: "committed",
      chainId,
      contractAddress: null,
      responder: null,
      blockNumber: log.args[0],
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
    }));

    const refundedEvents = refundedLogs.map((log) => ({
      type: "refunded",
      chainId,
      contractAddress: null,
      responder: null,
      blockNumber: log.args[0],
      headerIndex: log.args[1],
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
    }));

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

    console.log(`Finished processing chain: ${name}`);
  }
})();
