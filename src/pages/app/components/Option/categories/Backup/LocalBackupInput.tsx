import { ElSwitch } from 'element-plus'
import { computed, defineComponent } from 'vue'

type Props = {
    enabled: boolean
    offset: number
    onEnabledChange: (val: boolean) => void
    onOffsetChange: (val: number) => void
}

const toTime = (offset: number): string =>
    `${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`

export default defineComponent<Props>(props => {
    const time = computed(() => toTime(props.offset))

    return () => <>
        <ElSwitch
            modelValue={props.enabled}
            onChange={val => props.onEnabledChange(!!val)}
        />
        <span style={{ marginInline: '8px' }}>Daily local JSON backup</span>
        {props.enabled && <input
            type="time"
            value={time.value}
            onInput={(event: Event) => {
                const [hour = NaN, minute = NaN] = (event.target as HTMLInputElement).value.split(':').map(Number)
                if (Number.isInteger(hour) && Number.isInteger(minute)) props.onOffsetChange(hour * 60 + minute)
            }}
        />}
        {props.enabled && <span style={{ marginInlineStart: '8px' }}>
            Downloads/DigitalFootprint
        </span>}
    </>
}, { props: ['enabled', 'offset', 'onEnabledChange', 'onOffsetChange'] })
