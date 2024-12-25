#!/bin/bash

# source ~/.venv/bin/activate

# Check if virtual environment exists, create if not
if [ ! -d "~/.venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv ~/.venv
    source ~/.venv/bin/activate
else
    echo "Activating Python virtual environment..."
    source ~/.venv/bin/activate
fi

# Check for required Python packages
required_packages=("rlp" "hexbytes" "eth_hash" "web3")
for package in "${required_packages[@]}"; do
    if ! python3 -c "import $package" 2>/dev/null; then
        echo "Python package '$package' is not installed. Installing..."
        pip install "$package"
        if [ $? -ne 0 ]; then
            echo "Failed to install '$package'. Please check your Python environment."
            exit 1
        fi
    fi
done

if pgrep -x "anvil" > /dev/null; then
    echo "Anvil is running."
else
    echo "Anvil is not running."
    exit 1
fi

# Confirm whether the user wants to delete the data folder or not
if [ -d "data" ]; then
    read -p "The 'data' folder exists. Do you want to delete it? (y/n): " confirm
    case $confirm in
        [Yy]*)
            echo "Deleting 'data' folder..."
            rm -r data
            echo "'data' folder deleted."
            ;;
        [Nn]*)
            echo "Skipping deletion of 'data' folder."
            ;;
        *)
            echo "Invalid input. Please enter 'y' or 'n'."
            exit 1
            ;;
    esac
else
    echo "The 'data' folder does not exist."
fi

if [ ! -d "headerprotocol/contracts" ]; then
    echo "The 'headerprotocol/contracts' folder does not exist."
    echo "git clone https://github.com/headerprotocol/headerprotocol"
    exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Config
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

echo ""

# Deploy HeaderProtocol
HEADER_PROTOCOL=$(forge create --private-key $PRIVATE_KEY headerprotocol/contracts/v1/HeaderProtocol.sol:HeaderProtocol --broadcast | grep "Deployed to" | awk '{print $3}')
echo "HeaderProtocol deployed at: $HEADER_PROTOCOL"

# Deploy MockHeader 1
MOCK_HEADER1=$(forge create --private-key $PRIVATE_KEY headerprotocol/contracts/v1/mocks/MockHeader.sol:MockHeader --broadcast --constructor-args $HEADER_PROTOCOL | grep "Deployed to" | awk '{print $3}')
echo "MockHeader 1 deployed at: $MOCK_HEADER1"

# Deploy MockHeader 2
MOCK_HEADER2=$(forge create --private-key $PRIVATE_KEY headerprotocol/contracts/v1/mocks/MockHeader.sol:MockHeader --broadcast --constructor-args $HEADER_PROTOCOL | grep "Deployed to" | awk '{print $3}')
echo "MockHeader 2 deployed at: $MOCK_HEADER2"

for i in {0..10}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Request 20"

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 20 29

for i in {0..10}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Commit 20"

# Commit Block
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "commit(uint256)" 20

eval $(python3 "$SCRIPT_DIR/block.py" 20)

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Respond 20"

# Respond to Block Header
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "response(uint256,uint256,bytes,address)" 20 29 $BLOCK_HEADER_HEX $MOCK_HEADER1

# Respond to Block Header
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "response(uint256,uint256,bytes,address)" 20 4 $BLOCK_HEADER_HEX $MOCK_HEADER2

for i in {0..10}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Request 50"

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 50 1 --value 3300000000000000000

for i in {0..300}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Refund 50"

# Refund Task
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "refund(uint256,uint256)" 50 1

eval $(python3 "$SCRIPT_DIR/block.py" 300)

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Respond 300"

# Respond to Block Header
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "response(uint256,uint256,bytes,address)" 300 1 $BLOCK_HEADER_HEX $MOCK_HEADER1

# Respond to Block Header
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "response(uint256,uint256,bytes,address)" 300 1 $BLOCK_HEADER_HEX $MOCK_HEADER2

# Respond to Block Header
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "response(uint256,uint256,bytes,address)" 300 1 $BLOCK_HEADER_HEX $MOCK_HEADER1

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Commit 310"

# Commit Block
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "commit(uint256)" 310

eval $(python3 "$SCRIPT_DIR/block.py" 310)

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Respond 310"

# Respond to Block Header
cast send --private-key $PRIVATE_KEY $HEADER_PROTOCOL "response(uint256,uint256,bytes,address)" 310 2 $BLOCK_HEADER_HEX $MOCK_HEADER1

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Request 1,000,000 index 3"

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 1000000 3

for i in {0..100}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Request 1,000,000 double index 4"

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 1000000 4 --value 1111111

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 1000000 4 --value 2222222

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Request 460 index 3"

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 460 3

for i in {0..2}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null

node "$SCRIPT_DIR/indexer.js"

read -p "Press enter to Request 460 double index 4"

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 460 4 --value 543

# Request Block Header
cast send --private-key $PRIVATE_KEY $MOCK_HEADER1 "mockRequest(uint256,uint256)" 460 4 --value 765

node "$SCRIPT_DIR/indexer.js"

for i in {0..2}; do cast rpc evm_mine --rpc-url http://127.0.0.1:8545; done > /dev/null
