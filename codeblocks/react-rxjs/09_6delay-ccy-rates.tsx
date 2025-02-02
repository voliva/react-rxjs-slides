import { bind } from "@react-rxjs/core"
import { combineKeys, createKeyedSignal, createSignal } from "@react-rxjs/utils"
import { memo } from "react"
import {
  combineLatest,
  concat,
  defer,
  EMPTY,
  merge,
  Observable,
  of,
  OperatorFunction,
  pipe,
} from "rxjs"
import {
  connect,
  delay,
  distinctUntilChanged,
  filter,
  map,
  mergeMap,
  pluck,
  repeat,
  scan,
  startWith,
  switchMap,
  take,
  takeLast,
  takeWhile,
  withLatestFrom,
} from "rxjs/operators"
import {
  initialCurrencyRates,
  formatCurrency,
  NumberInput,
  formatPrice,
  initialOrders,
  Table,
  getBaseCurrencyPrice,
  uuidv4,
  getRandomOrder,
  isCurrecyRateValid,
} from "./utils"

const [useCurrencies, currencies$] = bind(
  EMPTY,
  Object.keys(initialCurrencyRates),
)

const [rateChange$, onRateChange] = createKeyedSignal<string, number>()

enum CurrencyRateState {
  ACCEPTED,
  DIRTY,
  IN_PROGRESS,
}

interface CurrencyRate {
  value: number
  state: CurrencyRateState
}

const [useCurrencyRate, currencyRate$] = bind(
  (currency: string): Observable<CurrencyRate> => {
    const latestAcceptedValue$ = acceptedCurrencyRates$(currency).pipe(take(1))

    const getNextAcceptedValue$ = (candidate: number) =>
      defer(() => isCurrecyRateValid(currency, candidate)).pipe(
        mergeMap((isOk) => (isOk ? of(candidate) : latestAcceptedValue$)),
        map((value) => ({
          value,
          state: CurrencyRateState.ACCEPTED,
        })),
        startWith({ value: candidate, state: CurrencyRateState.IN_PROGRESS }),
      )

    return rateChange$(currency).pipe(
      withLatestFrom(latestAcceptedValue$),
      switchMap(([value, latestAccepted]) =>
        value === latestAccepted
          ? of({ value, state: CurrencyRateState.ACCEPTED })
          : concat(
              of({ value, state: CurrencyRateState.DIRTY }),
              of(null).pipe(delay(500)),
            ),
      ),
      takeWhile((x): x is CurrencyRate => !!x),
      connect((source$) =>
        merge(
          source$,
          source$.pipe(
            takeLast(1),
            mergeMap(({ value }) => getNextAcceptedValue$(value)),
          ),
        ),
      ),
    )
  },
  (currency) => ({
    state: CurrencyRateState.ACCEPTED,
    value: initialCurrencyRates[currency],
  }),
)

const [, acceptedCurrencyRates$] = bind(
  pipe(
    currencyRate$,
    filter(({ state }) => state === CurrencyRateState.ACCEPTED),
    pluck("value"),
    distinctUntilChanged(),
  ),
)

const initialOrderIds = Object.keys(initialOrders)
const [addOrder$, onAddOrder] = createSignal()
const [useOrderIds, orderIds$] = bind(
  addOrder$.pipe(
    map(uuidv4),
    scan((acc, id) => [...acc, id], initialOrderIds),
  ),
  initialOrderIds,
)

const [priceChange$, onPriceChange] = createKeyedSignal<string, number>()
const [currencyChange$, onCurrencyChange] = createKeyedSignal<string, string>()

const [useOrder, order$] = bind((id: string) => {
  const initialOrder = initialOrders[id] || getRandomOrder(id)
  const price$ = concat([initialOrder.price], priceChange$(id))
  const currency$ = concat([initialOrder.currency], currencyChange$(id))

  const rate$ = currency$.pipe(switchMap((ccy) => acceptedCurrencyRates$(ccy)))
  const baseCurrencyPrice$ = combineLatest([price$, rate$]).pipe(
    map(([price, rate]) => getBaseCurrencyPrice(price, rate)),
  )

  return combineLatest({
    price: price$,
    currency: currency$,
    baseCurrencyPrice: baseCurrencyPrice$,
  }).pipe(map((update) => ({ ...initialOrder, ...update })))
})

const [useTotal, total$] = bind(
  combineKeys(orderIds$, pipe(order$, pluck("baseCurrencyPrice"))).pipe(
    map((prices) => Array.from(prices.values()).reduce((a, b) => a + b, 0)),
  ),
)

total$.subscribe()

const CurrencyRate: React.FC<{ currency: string }> = ({ currency }) => {
  const rate = useCurrencyRate(currency)
  return (
    <tr key={currency}>
      <td>{formatCurrency(currency)}</td>
      <td>
        <NumberInput
          value={rate}
          onChange={(value) => {
            onRateChange(currency, value)
          }}
        />
      </td>
    </tr>
  )
}

const Currencies = () => {
  const currencies = useCurrencies()
  return (
    <Table columns={["Currency", "Exchange rate"]}>
      {currencies.map((currency) => (
        <CurrencyRate key={currency} currency={currency} />
      ))}
    </Table>
  )
}

const CurrencySelector: React.FC<{
  value: string
  onChange: (next: string) => void
}> = ({ value, onChange }) => {
  const currencies = useCurrencies()
  return (
    <select
      onChange={(e) => {
        onChange(e.target.value)
      }}
      value={value}
    >
      {currencies.map((c) => (
        <option key={c} value={c}>
          {formatCurrency(c)}
        </option>
      ))}
    </select>
  )
}

const Orderline: React.FC<{ id: string }> = memo(({ id }) => {
  const order = useOrder(id)
  return (
    <tr>
      <td>{order.title}</td>
      <td>
        <NumberInput
          value={order.price}
          onChange={(value) => {
            onPriceChange(id, value)
          }}
        />
      </td>
      <td>
        <CurrencySelector
          value={order.currency}
          onChange={(value) => {
            onCurrencyChange(id, value)
          }}
        />
      </td>
      <td>{formatPrice(order.baseCurrencyPrice)} £</td>
    </tr>
  )
})

const Orders = () => {
  const orderIds = useOrderIds()
  return (
    <Table columns={["Article", "Price", "Currency", "Price in £"]}>
      {orderIds.map((id) => (
        <Orderline key={id} id={id} />
      ))}
    </Table>
  )
}

const OrderTotal = () => {
  const total = useTotal()
  return <div className="total">{formatPrice(total)} £</div>
}

const App = () => (
  <div className="App">
    <h1>Orders</h1>
    <Orders />
    <div className="actions">
      <button onClick={onAddOrder}>Add</button>
      <OrderTotal />
    </div>
    <h1>Exchange rates</h1>
    <Currencies />
  </div>
)

export default App
