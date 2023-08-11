import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';

import { configureChains, createConfig } from '@wagmi/core'
// import { mainnet, goerli } from '@wagmi/core/chains'
import { mainnet, goerli } from 'viem/chains'
import { publicProvider } from '@wagmi/core/providers/public'
import { createPublicClient, createWalletClient, decodeAbiParameters, numberToHex, http, hexToBigInt, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { CROC_CHAINS } from './constants.mjs'
import { CROC_ABI } from './abis/croc.mjs'
import { QUERY_ABI } from './abis/query.mjs'
import { decodeCrocPrice } from './utils.mjs';


const TRANSPORTS = {
  1: { http: http("https://rpc.flashbots.net/?builder=flashbots&builder=f1b.io&builder=rsync&builder=beaverbuild.org&builder=builder0x69&builder=titan&builder=eigenphi&builder=boba-builder"), tx: http("https://rpc.flashbots.net/?builder=flashbots&builder=f1b.io&builder=rsync&builder=beaverbuild.org&builder=builder0x69&builder=titan&builder=eigenphi&builder=boba-builder"), chain: mainnet },
  5: { http: http("https://goerli.infura.io/v3/afea1acbc0be4ad7bf22a841a0e7ef63"), tx: http("https://goerli.infura.io/v3/afea1acbc0be4ad7bf22a841a0e7ef63"), chain: goerli },
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const RELAY_SPEC = {
  tipTokens: {
    1: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", ZERO_ADDRESS, "0xdac17f958d2ee523a2206206994597c13d831ec7", "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", "0x6b175474e89094c44da98b954eedeac495271d0f"],
    5: [ZERO_ADDRESS, "0xd87ba7a50b2e7e660f678a895e4b72e7cb4ccd9c", "0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60", "0xc04b0d3107736c32e19f1c62b2af67be61d63a05"]
  },
  tipRecv: [numberToHex(256, { size: 20 }), '0x09784d03b42581cfc4fc90a7ab11c3125dedeb86', '0xb4fdaf8e6636e7394f6ae768c5fa9d2e5bf6f0dc'],
  tipThreshold: 0.85,  // actual tip must at least cover this amount of gasFee
  maxFeePerGasIncrease: { 1: 1.25, 5: 5 },  // multiplies current gas by this number, based on chainId
}

const ALREADY_SENT = {}
const TX_STATUSES = {}

const { chains, publicClient, webSocketPublicClient } = configureChains(
  [mainnet, goerli],
  [publicProvider()],
)

const config = createConfig({
  autoConnect: true,
  publicClient,
  webSocketPublicClient,
})

if (process.env.DRY)
  console.log('Dry mode')

const CLIENTS = {}
for (const [chainId, transport] of Object.entries(TRANSPORTS)) {
  const client = createPublicClient({ chain: transport.chain, transport: transport.http })
  const wallet = createWalletClient({
    account: privateKeyToAccount(process.env.PK),
    chain: transport.chain, transport: transport.tx,
  })
  CLIENTS[chainId] = { client, wallet }
}

const app = express();
// dirty response logging hack
const originalSend = app.response.send
app.response.send = function sendOverWrite(body) {
  originalSend.call(this, body)
  this.__custombody__ = body
}

app.use(cors());
app.use(express.json({ type: "*/*" }))

const logFormat = ":date[iso] - :url - :status - :response-time ms - :body - :res-body"
const accessLogStream = fs.createWriteStream(
  'relayer.log',
  {
    flags: 'a',
  }
);
morgan.token('body', (req, res) => JSON.stringify(req.body))
morgan.token('res-body', (_req, res) =>
  res.__custombody__,
)

app.use(
  morgan(logFormat, {
    stream: accessLogStream,
  })
);

app.use(morgan(logFormat));

function parseTip(tip, chainId) {
  if (tip == '0x')
    throw "No tip attached"
  let [token, amount, recv] = decodeAbiParameters(
    [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint128' },
      { name: 'recv', type: 'address' },
    ],
    tip
  )
  console.log('parsed tip', token, amount, recv)
  token = token.toLowerCase()
  recv = recv.toLowerCase()

  if (!RELAY_SPEC.tipTokens[chainId].includes(token))
    throw "Unsupported tip token"

  if (!RELAY_SPEC.tipRecv.includes(recv))
    throw "Incorrect tip receiver"

  return { token, amount }
}

async function convertTipToETH(token, amount, chainId) {
  console.log('converting tip', token, amount)
  if (token == ZERO_ADDRESS) {
    return amount
  } else {
    const price = await getPrice(token, ZERO_ADDRESS, chainId)
    const converted = BigInt(Math.round(parseInt(amount) * price))
    console.log('converted', converted)
    return converted
  }
  throw "bad tip"
}

async function getPrice(priceOf, relativeTo, chainId) {
  const invert = hexToBigInt(priceOf) > hexToBigInt(relativeTo)
  if (invert)
    [priceOf, relativeTo] = [relativeTo, priceOf]
  const pos = { base: priceOf, quote: relativeTo, poolIdx: CROC_CHAINS[chainId].poolIndex }
  const poolPrice = await fetchPoolPrice(pos, chainId)
  console.log('gotPrice', poolPrice)
  return poolPrice
}

async function fetchPoolPrice(pool, chainId) {
  const client = CLIENTS[chainId].client
  const price = await client.readContract({
    address: CROC_CHAINS[chainId].addrs.query, abi: QUERY_ABI, functionName: "queryPrice",
    args: [pool.base, pool.quote, pool.poolIdx]
  })
  console.log('raw price', price)
  return decodeCrocPrice(price)
}

async function estimateRelay(cmd) {
  const client = CLIENTS[cmd.chainId].client
  const wallet = CLIENTS[cmd.chainId].wallet
  let gas = await client.estimateContractGas({
    functionName: 'userCmdRelayer', args: [cmd.callpath, cmd.cmd, cmd.conds, cmd.tip, cmd.sig],
    address: CROC_CHAINS[cmd.chainId].addrs.dex, abi: CROC_ABI,
    account: wallet.account
  })

  console.log('gas', gas)
  return gas
}

async function isTipEnough(cmd, gasPrice) {
  const { token, amount } = parseTip(cmd.tip, cmd.chainId)
  const ethTip = await convertTipToETH(token, amount, cmd.chainId)
  const gasNeeded = await estimateRelay(cmd)
  const gasFee = gasNeeded * gasPrice
  console.log('gasFee', gasFee, 'ethTip', ethTip)

  const ratio = parseInt(ethTip * 10000n / gasFee) / 10000
  console.log('tip ratio', ratio)
  if (ratio < RELAY_SPEC.tipThreshold)
    return false

  return true
}

async function sendRelayerTx(cmd, maxFeePerGas) {
  const client = CLIENTS[cmd.chainId].client
  const wallet = CLIENTS[cmd.chainId].wallet
  try {
    const maxPriorityFeePerGas = parseGwei('0.35') // # TODO: this sucks
    const sim = await client.simulateContract({
      functionName: 'userCmdRelayer', args: [cmd.callpath, cmd.cmd, cmd.conds, cmd.tip, cmd.sig],
      address: CROC_CHAINS[cmd.chainId].addrs.dex, abi: CROC_ABI,
      // account: wallet.account,
      account: ZERO_ADDRESS,
      maxFeePerGas, maxPriorityFeePerGas: maxFeePerGas < maxPriorityFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
    })
    console.log('sim', sim)
    sim.request.account = wallet.account
    if (process.env.DRY)
      return "0xdccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    else
      return await wallet.writeContract(sim.request)
  } catch (e) {
    console.error('sendRelayerTx error', e)
    throw e
  }
}

async function relay(cmd) {
  const resp = { success: false, reason: "" }
  const client = CLIENTS[cmd.chainId].client
  try {
    const gasNow = await client.getGasPrice()
    console.log('gasNow', gasNow)

    if (!(await isTipEnough(cmd, gasNow))) {
      resp.reason = "Tip doesn't cover the gas, refresh and try again"
      return resp
    }

    const alreadyHash = ALREADY_SENT[cmd.sig]
    if (alreadyHash) {
      resp.reason = `Already sent this command, TX hash: ${alreadyHash}`
      return resp
    }

    const maxFeePerGas = BigInt(parseInt(parseInt(gasNow) * RELAY_SPEC.maxFeePerGasIncrease[cmd.chainId]))
    console.log('gasNow', gasNow, 'maxFeePerGas', maxFeePerGas)
    // throw "bad"
    const hash = await sendRelayerTx(cmd, maxFeePerGas)
    ALREADY_SENT[cmd.sig] = hash
    TX_STATUSES[hash] = 'PENDING'
    resp.success = true
    resp.hash = hash
    delete resp.reason
  } catch (e) {
    console.error('relay() error', e)
    resp.reason = `Internal relayer error`
  }
  return resp
}

async function txStatus(hash, chainId) {
  const status = { success: null, status: 'Unknown' }
  let knownStatus = TX_STATUSES[hash]
  if (knownStatus == 'PENDING' || knownStatus == 'UNKNOWN' || knownStatus == undefined) {
    if (chainId == mainnet.id) {
      const resp = await fetch(`https://protect.flashbots.net/tx/${hash}`)
      // console.log('Fetched flashbots status', resp)
      const json = await resp.json()
      // console.log('Flashbots status', json)
      TX_STATUSES[hash] = json.status
      knownStatus = json.status
    } else {
      try {
        const receipt = await client.getTransactionReceipt({ hash })
        // console.log('Fetched TX receipt', receipt)
        if (receipt.status == 'success') {
          TX_STATUSES[hash] = 'INCLUDED'
          knownStatus = 'INCLUDED'
        } else {
          TX_STATUSES[hash] = 'FAILED'
          knownStatus = 'FAILED'
        }
      } catch (e) {
        console.error('tx status error', e)
        TX_STATUSES[hash] = 'PENDING'
        knownStatus = 'PENDING'
      }
    }
  }

  if (knownStatus == 'PENDING') {
    status.success = null
    status.status = 'Pending'
  } else if (knownStatus == 'INCLUDED') {
    status.success = true
    status.status = 'Included'
  } else if (knownStatus == 'FAILED' || knownStatus == 'CANCELLED') {
    status.success = false
    status.status = 'Failed'
  }
  return status
}

app.post("/relay", async (req, res) => {
  // const o = await client.getGasPrice()
  let resp = { success: false, reason: 'Internal error' }
  try {
    const cmd = req.body
    console.log('Received cmd:', cmd)
    if (!cmd || cmd == {} || Object.keys(cmd).length == 0) {
      res.status(400).json({ success: false, reason: "Empty command" })
      return
    }
    resp = await relay(cmd)
  } catch (e) {
    console.error('relay() error', e)
    res.status(500).json(resp);
    return
  }
  res.status(200).json(resp);
});

app.get("/status", async (req, res) => {
  // const o = await client.getGasPrice()
  let resp = { success: null, status: 'Unknown' }
  try {
    const hash = req.query.tx
    if (true) {
      resp = await txStatus(hash, req.query.chainId)
      // resp = await txStatus(hash, false)
    } else {
      resp.success = false
      resp.status = 'Unknown transaction'
    }
  } catch (e) {
    console.error('txStatus() error', e)
    res.status(500).json(resp);
    return
  }
  res.status(200).json(resp);
});

import process from 'process'
process.on('SIGINT', () => {
  console.log("SIGINT")
  process.exit(0)
})
process.on('SIGTERM', () => {
  console.log("SIGTERM")
  process.exit(0)
})

app.listen(80);

