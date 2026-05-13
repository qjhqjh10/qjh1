import { countChineseWords, formatWordCount } from '@/utils/textUtils'

interface Props {
  text: string
  label?: string
}

export default function WordCount({ text, label = '字数' }: Props) {
  const count = countChineseWords(text)
  return (
    <span style={{ fontSize: 12, color: '#9b8e84', whiteSpace: 'nowrap' }}>
      {label}: {formatWordCount(count)}
    </span>
  )
}
