# HeaderProtocol Indexer

The **HeaderProtocol Indexer** is an advanced blockchain indexing solution designed to track multiple events related to block header requests and their lifecycle. It processes logs from EVM-compatible blockchains, organizes and merges event data, and ensures consistency across daily snapshots.

---

## Features

### Multi-Chain Compatibility

Easily configured to work with any EVM-compatible chain. Just provide the network details, and the indexer adapts to handle its logs.

### Event Tracking

The indexer tracks four key events from the contract:

1. **BlockHeaderRequested**  
   Emitted when a block header request is created.

   **Fields:**

   - `contractAddress`: The address of the contract making the request.
   - `blockNumber`: The requested block number.
   - `headerIndex`: The index of the requested header field.
   - `feeAmount`: The fee offered for fulfilling the request (in wei).

2. **BlockHeaderResponded**  
   Emitted when a block header request is successfully fulfilled.

   **Fields:**

   - `responder`: The address that responded with the requested header.
   - `blockNumber`: The block number that was fulfilled.
   - `headerIndex`: The index of the fulfilled header field.

3. **BlockHeaderCommitted**  
   Emitted when a block hash is successfully committed.

   **Fields:**

   - `blockNumber`: The block number for which the blockhash was committed.

4. **BlockHeaderRefunded**  
   Emitted when a refund is processed for a request that cannot be completed.

   **Fields:**

   - `blockNumber`: The block number of the refunded request.
   - `headerIndex`: The header index of the refunded request.

### Merging and Deduplication

All events are merged into a single, consistent JSON structure. The merge process ensures:

- **Requested & Responded**: Requests are matched with responses if they share the same `blockNumber` and `headerIndex`.
- **Committed Events**: If a commit occurs for a given `blockNumber`, all related requests/responses for that `blockNumber` are updated to reflect the commit. If no related requests exist, a separate commit-only record is created.
- **Refunded Events**: For a refunded `blockNumber` and `headerIndex`, the corresponding request/response record is updated to include refund details. If no matching request/response record exists, a new refund-only record is created.

### Consistent Data Storage

- **Network-Specific Folders**: Each network has its own directory.
- **Daily Files**: Events are stored in daily files named `YYYY-MM-DD.json`.
- **Block Range Files**: `block_ranges.json` records the start and end blocks indexed for each day.
- **Global Tracker**: `last_blocks.json` maintains the last processed block for each network.

### Handling Block Ranges

The indexer respects RPC limitations by splitting large block ranges into smaller chunks, ensuring compatibility with various RPC providers.

### Detailed Logging

- Chains being processed.
- Block ranges fetched.
- Number of logs fetched per event type.
- Updated daily event files and trackers.

---

## Data Structure

Each event object in the daily JSON file contains the following fields:

```json
{
  "chainId": "1",
  "contractAddress": "0x...",
  "responder": "0x...",
  "blockNumber": "123456",
  "headerIndex": "1",
  "feeAmount": "1000000000",

  "requestedBlockNumber": "123450",
  "requestedTransactionHash": "0x...",
  "requestedBlockHash": "0x...",

  "respondedBlockNumber": "123460",
  "respondedTransactionHash": "0x...",
  "respondedBlockHash": "0x...",

  "committedBlockNumber": "123470",
  "committedTransactionHash": "0x...",
  "committedBlockHash": "0x...",

  "refundedBlockNumber": "123480",
  "refundedTransactionHash": "0x...",
  "refundedBlockHash": "0x...",

  "createdAt": "2024-12-10T12:00:00Z",
  "updatedAt": "2024-12-10T12:05:00Z"
}
```

**Notes:**

- `blockNumber` and `headerIndex` refer to the requested/resolved/refunded data fields.
- `requestedBlockNumber`, `respondedBlockNumber`, `committedBlockNumber`, and `refundedBlockNumber` refer to the actual blockchain block number in which the event was recorded.
- Transaction and block hashes (`requestedTransactionHash`, `respondedTransactionHash`, `committedTransactionHash`, `refundedTransactionHash`, etc.) correspond to the events themselves.

### Block Range Files (`block_ranges.json`)

Tracks the daily block ranges processed:

```json
{
  "2024-12-10": {
    "startBlock": "21368974",
    "endBlock": "21369974"
  }
}
```

### Global Block Tracker (`last_blocks.json`)

Tracks the last processed block for each network:

```json
{
  "ethereum": {
    "fromBlock": "21369975"
  },
  "polygon": {
    "fromBlock": "65294773"
  }
}
```

---

## Improvements and Benefits

### Holistic Event View

Combining requested, responded, committed, and refunded events into a single record (when applicable) provides a comprehensive view of the request lifecycle.

### Block-Level Consistency

Committed events, which apply to all requests at a given blockNumber, ensure data completeness by updating multiple records simultaneously.

### Flexible Data Structure

The indexer gracefully handles cases where events (like commits or refunds) occur independently of requests or responses, creating standalone entries where necessary.

### Easy Analysis

Storing all data points in a uniform JSON structure facilitates analysis, debugging, and integration with downstream applications.

---

## Directory Structure

```
data/
├── ethereum/
│   ├── 2024-12-10.json       # Daily events with requested/responded/committed/refunded data
│   ├── block_ranges.json     # Daily block range tracker
├── polygon/
│   ├── 2024-12-10.json
│   ├── block_ranges.json
├── last_blocks.json          # Global tracker for last processed blocks
```
