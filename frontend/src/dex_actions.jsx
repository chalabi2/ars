import cloneDeep from 'lodash.clonedeep'

const BASE_COMMAND = {
  _descripnion: "Unknown command",
  _useRelayer: true,
  _relayerAddr: null,
  _relayManually: false,
  _selectedRelayer: 'bus',
  _selectedTipToken: null,
  _tipEstimates: { null: { text: 'No estimate yet', value: null, amount: 0 } },
  _gasPrice: null,
  tip: {
    token: null, amount: null, // recv: null, // always for now 256 - the relayer's signer
  },
}

export const COMMANDS = {
  null: {
    _type: null,
    text: 'Select a command',
  },
  withdraw: {
    _type: 'withdraw',
    text: 'Withdraw DEX balance',
    recv: null,
    qty: null, // human string with decimal point
    token: null,
    _qtyRaw: null,
    _qtyDecimals: 0,
    ...cloneDeep(BASE_COMMAND),
  },
  transfer: {
    _type: 'transfer',
    text: 'Transfer to different DEX balance',
    recv: null,
    qty: null, // human string with decimal point
    token: null,
    _qtyRaw: null,
    _qtyDecimals: 0,
    ...cloneDeep(BASE_COMMAND),
  },
  removeConcLp: {
    _type: 'removeConcLp',
    text: 'Remove LP',
    code: 2,
    base: null,
    quote: null,
    poolIdx: null,
    bidTick: null,
    askTick: null,
    qty: null,
    limitLower: null,
    limitHigher: null,
    settleFlags: 3,
    lpConduit: null,
    positionType: 'concentrated',

    _slippage: 0.5,
    _qtyPct: 100,
    _baseDecimals: null,
    _quoteDecimals: null,
    ...cloneDeep(BASE_COMMAND),
  },
  removeAmbLp: {
    _type: 'removeAmbLp',
    text: 'Remove ambient LP',
    code: 3,
    base: null,
    quote: null,
    poolIdx: null,
    qty: null,
    limitLower: null,
    limitHigher: null,
    settleFlags: 3,
    lpConduit: null,
    positionType: 'ambient',

    _slippage: 0.5,
    _qtyPct: 100,
    _baseDecimals: null,
    _quoteDecimals: null,
    ...cloneDeep(BASE_COMMAND),
  }
}

// no need for proper bitflags yet
export const SETTLE_TO_WALLET = 0
export const SETTLE_TO_DEX = 3

// no need for proper bitflags yet
export const SETTLE_FLAGS = [
  {
    value: SETTLE_TO_WALLET,
    text: 'To wallet',
  },
  //  1: {
  //    value: 1,
  //    text: 'Base to DEX balance',
  //  },
  //  2: {
  //    value: 2,
  //    text: 'Quote to DEX balance',
  //  },
  {
    value: SETTLE_TO_DEX,
    text: 'To DEX balance',
  },
]