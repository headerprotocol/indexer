import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet, polygon } from "viem/chains";

// Configuration
const NETWORKS = [
  {
    name: "ethereum",
    client: createPublicClient({ chain: mainnet, transport: http() }),
    chainId: 1,
    fromBlock: 21368974n, // Starting block for Ethereum if tracking starts fresh
  },
  {
    name: "polygon",
    client: createPublicClient({ chain: polygon, transport: http() }),
    chainId: 137,
    fromBlock: 65293772n, // Starting block for Polygon if tracking starts fresh
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

// Helpers
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

const loadTrackerFile = (filepath) => {
  try {
    return parseWithBigInt(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
};

const saveTrackerFile = (filepath, data) => {
  fs.writeFileSync(filepath, stringifyWithBigInt(data));
};

const stringifyWithBigInt = (data) =>
  JSON.stringify(
    data,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );

const parseWithBigInt = (data) =>
  JSON.parse(data, (_, value) => (/^\d+$/.test(value) ? BigInt(value) : value));

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

  for (const {
    name,
    client,
    chainId,
    fromBlock: defaultFromBlock,
  } of NETWORKS) {
    console.log(`------------ Processing chain: ${name} ------------`);

    const networkDir = path.join(DATA_DIR, name);
    const blockRangesFile = path.join(networkDir, "block_ranges.json");
    const lastBlocksFile = path.join(DATA_DIR, "last_blocks.json");

    ensureDirExists(networkDir);

    const lastBlocks = loadTrackerFile(lastBlocksFile);
    const blockRanges = loadTrackerFile(blockRangesFile);

    // Use defaultFromBlock if no tracking data exists
    const fromBlock = BigInt(lastBlocks[name]?.fromBlock || defaultFromBlock);
    const latestBlock = await client.getBlockNumber();
    const toBlock = latestBlock;

    console.log(`Fetching logs from block ${fromBlock} to ${toBlock}...`);

    const requestedLogs = await fetchLogsInRange(
      client,
      ABI_EVENTS[0],
      fromBlock,
      toBlock
    );
    const respondedLogs = await fetchLogsInRange(
      client,
      ABI_EVENTS[1],
      fromBlock,
      toBlock
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
        startBlock: fromBlock.toString(), // Store as string for consistency
        endBlock: toBlock.toString(), // Store as string for consistency
      };
    } else {
      blockRanges[today].endBlock = toBlock.toString(); // Store as string
    }

    console.log(`Updating block ranges: ${fromBlock} - ${toBlock}`);
    saveTrackerFile(blockRangesFile, blockRanges);

    lastBlocks[name] = { fromBlock: (toBlock + 1n).toString() }; // Store as string
    console.log(`Updating last processed block to ${toBlock + 1n}`);
    saveTrackerFile(lastBlocksFile, lastBlocks);

    console.log(`-------- Finished processing chain: ${name} -------\n`);
  }
})();
