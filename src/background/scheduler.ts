import { MILL_PER_MINUTE } from "@util/time"
import alarmManager from "./alarm-manager"
import backupProcessor from "./service/backup/processor"
import optionHolder from './service/components/option-holder'
import notificationProcessor from "./service/notification/processor"
import { exportData } from './service/components/immigration'
import { formatTime } from '@util/time'

const BACKUP_ALARM_NAME = 'auto-backup-data'
const NOTIFICATION_ALARM_NAME = 'notification-data'
const LOCAL_BACKUP_ALARM_NAME = 'local-auto-backup-data'

const needResetBackup = (newVal: tt4b.option.AllOption, oldVal: tt4b.option.AllOption): boolean =>
    newVal.autoBackUp !== oldVal.autoBackUp || newVal.autoBackUpInterval !== oldVal.autoBackUpInterval

const needResetNotification = (newVal: tt4b.option.AllOption, oldVal: tt4b.option.AllOption): boolean =>
    newVal.notificationCycle !== oldVal.notificationCycle || newVal.notificationOffset !== oldVal.notificationOffset

const needResetLocalBackup = (newVal: tt4b.option.AllOption, oldVal: tt4b.option.AllOption): boolean =>
    newVal.localAutoBackUp !== oldVal.localAutoBackUp || newVal.localBackUpOffset !== oldVal.localBackUpOffset

export async function initScheduler(): Promise<void> {
    optionHolder.addChangeListener((newVal, oldVal) => {
        if (needResetBackup(newVal, oldVal)) resetBackup()
        if (needResetNotification(newVal, oldVal)) resetNotification()
        if (needResetLocalBackup(newVal, oldVal)) resetLocalBackup()
    })

    const existBackup = await alarmManager.getAlarm(BACKUP_ALARM_NAME)
    !existBackup && await resetBackup()

    const existNotification = await alarmManager.getAlarm(NOTIFICATION_ALARM_NAME)
    !existNotification && await resetNotification()

    // Alarm handlers live in the service worker's memory, while Chrome alarms
    // survive service-worker suspension. Always re-register the local handler
    // when the worker starts; otherwise an existing alarm can fire with no
    // corresponding in-memory callback.
    await resetLocalBackup()
}

const nextDailyTime = (offset: number): number => {
    const next = new Date()
    next.setHours(0, offset, 0, 0)
    while (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
    return next.getTime()
}

const downloadLocalBackup = async (): Promise<void> => {
    const data = await exportData()
    const timestamp = formatTime(new Date(), '{y}{m}{d}_{h}{i}{s}')
    const json = JSON.stringify(data, null, 4)
    await chrome.downloads.download({
        url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
        filename: `DigitalFootprint/timer_backup_${timestamp}.json`,
        conflictAction: 'uniquify',
        saveAs: false,
    })
}

async function resetLocalBackup(): Promise<void> {
    await alarmManager.remove(LOCAL_BACKUP_ALARM_NAME)
    const option = await optionHolder.get()
    if (!option.localAutoBackUp) return

    await alarmManager.setWhen(
        LOCAL_BACKUP_ALARM_NAME,
        () => nextDailyTime(option.localBackUpOffset),
        downloadLocalBackup,
    )
}

async function resetBackup(): Promise<void> {
    // MUST read latest option from database
    const option = await optionHolder.get()

    await alarmManager.remove(BACKUP_ALARM_NAME)

    const { autoBackUp, backupType, autoBackUpInterval = 0 } = option
    if (backupType === 'none' || !autoBackUp || !autoBackUpInterval) {
        return
    }

    const interval = autoBackUpInterval * MILL_PER_MINUTE
    await alarmManager.setInterval(BACKUP_ALARM_NAME, interval, async () => {
        const errorMsg = await backupProcessor.syncData()
        if (errorMsg) console.warn(`Failed to backup ts=${Date.now()}, msg=${errorMsg}`)
    })
}

type OffsetHandler = (offsetMin: number) => number
const OFFSET_HANDLERS: Record<Exclude<tt4b.notification.Cycle, 'none'>, OffsetHandler> = {
    daily: offset => {
        const next = new Date()
        next.setHours(0, offset, 0, 0)
        const now = new Date()
        while (next.getTime() < now.getTime()) {
            next.setDate(next.getDate() + 1)
        }
        return next.getTime()
    },
    weekly: offset => {
        const next = new Date()
        const weekday = next.getDay()
        // Convert JS Sunday-based weekday (Sun=0) to Monday-based (Mon=0)
        const mondayBasedWeekday = (weekday + 6) % 7
        next.setDate(next.getDate() - mondayBasedWeekday)
        next.setHours(0, offset, 0, 0)
        const now = new Date()
        while (next.getTime() < now.getTime()) {
            next.setDate(next.getDate() + 7)
        }
        return next.getTime()
    }
}

async function resetNotification(): Promise<void> {
    await alarmManager.remove(NOTIFICATION_ALARM_NAME)

    const option = await optionHolder.get()
    const { notificationCycle: cycle, notificationOffset: offset } = option

    if (cycle === 'none') return

    await alarmManager.setWhen(
        NOTIFICATION_ALARM_NAME,
        () => OFFSET_HANDLERS[cycle](offset),
        async () => {
            const errMsg = await notificationProcessor.doSend()
            if (errMsg) {
                console.warn(`Failed to send notification ts=${Date.now()}, msg=${errMsg}`)
            }
        }
    )
}
