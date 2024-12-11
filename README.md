# HeaderProtocol: Event Indexer Service

<div style="text-align:center" align="center">
    <img src="https://raw.githubusercontent.com/headerprotocol/headerprotocol/master/logo.png" width="200">
</div>

---

This indexer processes and merges multiple event types from EVM-compatible blockchains into structured JSON files. Events tracked:

- **BlockHeaderRequested(blockNumber+headerIndex)**: A request for a block header.
- **BlockHeaderResponded(blockNumber+headerIndex)**: A response to a previous request.
- **BlockHeaderCommitted(blockNumber)**: Indicates a block header has been fully committed.
- **BlockHeaderRefunded(blockNumber+headerIndex)**: A refund event for requests that cannot be completed.

## Key Features

1. **Single Query for All Events**: Combines multiple event ABIs into a single `getLogs` call for efficiency.
2. **Robust Event Merging**:
   - Requests, Responses, and Refunds are keyed by `(blockNumber + headerIndex)`.
   - Committed events are keyed by `(blockNumber)`.
     This prevents duplicates and creates a unified record for each request cycle.
3. **Daily & Monthly Files**:
   - Stores events in daily JSON files named `YYYY-MM-DD.json`.
   - After each run, merges all daily files for the month into a `YYYY-MM.json` file.
   - If any daily file updates, the monthly file is rebuilt to ensure consistency.
4. **Block Range Tracking**:
   - Keeps track of the last processed block for each network.
   - Manages block range queries in chunks (max 800 blocks) to avoid RPC limitations.
5. **Data Consistency**:
   - All block numbers, indexes, and event fields are consistently stored as strings.
   - Timestamps `createdAt` and `updatedAt` are recorded.
6. **Scalability & Transparency**:
   - Detailed logging.
   - Works with any EVM-compatible network.

## File Structure

```
data/
├── ethereum/
│   ├── 2024-12-10.json       # Daily events
│   ├── 2024-12.json          # Monthly aggregated file for December 2024
│   ├── block_ranges.json     # Tracks daily block ranges
├── polygon/
│   ├── 2024-12-10.json
│   ├── 2024-12.json
│   ├── block_ranges.json
├── last_blocks.json          # Tracks the last processed block for each network
```

## Data Structure

Each event entry in the daily and monthly JSON looks like:

```json
{
  "chainId": "1",
  "contractAddress": "0x...",
  "responder": "0x...",
  "blockNumber": "21369000",
  "headerIndex": "5",
  "rewardAmount": "1000000000",

  "requestedBlockNumber": "21369000",
  "requestedTransactionHash": "0x...",
  "requestedBlockHash": "0x...",

  "respondedBlockNumber": "21369010",
  "respondedTransactionHash": "0x...",
  "respondedBlockHash": "0x...",

  "committedBlockNumber": "21369020",
  "committedTransactionHash": "0x...",
  "committedBlockHash": "0x...",

  "refundedBlockNumber": "21369030",
  "refundedTransactionHash": "0x...",
  "refundedBlockHash": "0x...",

  "createdAt": "2024-12-10T12:00:00Z",
  "updatedAt": "2024-12-10T12:05:00Z"
}
```

Not all fields are always present. For example, if no refund occurred for a request, `refundedBlockNumber` and related fields remain `null`.

## How it Works

1. **Initialization**: Reads `last_blocks.json` and `block_ranges.json` to determine where to start.
2. **Fetching Events**:
   - Uses `viem`'s `getLogs` with multiple ABIs.
   - Decodes logs into structured `args` automatically.
3. **Merging Events**:
   - Calls `mergeEvents` to unify data into daily files.
   - Creates or updates monthly files after every daily run.
4. **Updating Trackers**:
   - Updates `block_ranges.json` and `last_blocks.json` accordingly.

## Benefits

- Offers a complete view of requests, responses, commits, and refunds in a single dataset.
- Enables straightforward analysis, charting, and reporting.
- Scales with blockchain growth and handles large block ranges efficiently.
