import {useState, type FormEvent} from 'react';
import {api, useDataset} from '../state/Dataset';
import {Modal} from './Community';

/**
 * 轻量勘误入口。
 *
 * 和「添加人物 / 添加关系」的区别是刻意的：那两个表单要求填完整实体，
 * 门槛高，只适合真正想补内容的人。而大多数人只是想指出「这张头像不是他」
 * 「这条关系写错了」——一句话就够，不该逼他填一份档案。
 *
 * 勘误不改数据本身，只进站长队列，由人核对后再决定是否走正式投稿流程。
 */
export type ReportTarget = {
  type: 'artist' | 'avatar' | 'relation' | 'work';
  id: string;
  /** 展示用的人名 / 关系描述，让站长一眼知道在说谁。 */
  label: string;
  /** 关系类勘误带上关系说明，便于对照。 */
  detail?: string;
};

const ISSUES: Record<ReportTarget['type'], [string, string][]> = {
  artist: [['info', '资料写错了'], ['missing', '缺少人物'], ['source', '来源打不开'], ['other', '其他']],
  avatar: [['wrong-person', '头像不是本人'], ['low-quality', '图片太糊 / 不合适'], ['missing', '没有头像'], ['other', '其他']],
  relation: [['not-true', '这条关系不实'], ['wrong-person', '人物选错了'], ['wrong-type', '关系类型不对'], ['missing', '缺少这条关系'], ['other', '其他']],
  work: [['info', '作品信息有误'], ['missing', '缺少作品'], ['source', '来源打不开'], ['other', '其他']],
};

const TITLES: Record<ReportTarget['type'], string> = {
  artist: '报告资料问题',
  avatar: '报告头像问题',
  relation: '报告关系问题',
  work: '报告作品问题',
};

export function ReportDialog({target, onClose}: {target: ReportTarget; onClose: () => void}) {
  const {online} = useDataset();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{id: string}>('/reports', {
        targetType: target.type,
        targetId: target.id,
        issue: form.get('issue'),
        message: form.get('message'),
        sourceUrl: form.get('sourceUrl'),
        contact: form.get('contact'),
        // 蜜罐：真人看不见，机器人会填。
        website: form.get('website'),
      });
      setReceipt(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={TITLES[target.type]} onClose={onClose}>
    {receipt ? <div className="submission-success">
      <span className="success-record">✓</span>
      <h3>已收到，谢谢</h3>
      <p>站长核对来源后会修正或退回。勘误不改动公开数据，只有确认后才生效。</p>
      <p className="receipt">勘误编号：{receipt}</p>
      <button className="primary" onClick={onClose}>知道了</button>
    </div> : <form onSubmit={submit} className="report-form">
      <p className="form-intro">
        正在反馈：<b>{target.label}</b>
        {target.detail && <><br /><small>{target.detail}</small></>}
      </p>
      {!online && <p role="alert" className="notice error">勘误服务未连接，暂时无法提交。</p>}

      <label>问题类型
        <select name="issue" defaultValue={ISSUES[target.type][0][0]}>
          {ISSUES[target.type].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>

      <label>具体哪里不对 *<textarea name="message" required minLength={6} maxLength={800} rows={3}
        data-autofocus placeholder="越具体越好，例如：2021 年那首《XXX》的客串不是他，署名是另一位" /></label>

      <label>可查证的链接<small>能打开的资料来源页，不要填网站首页</small>
        <input name="sourceUrl" type="url" maxLength={500} placeholder="https://…（选填）" /></label>

      <label>你的昵称<input name="contact" maxLength={60} placeholder="匿名乐迷（选填）" /></label>
      <div className="honey" aria-hidden="true"><label>网站<input name="website" tabIndex={-1} autoComplete="off" /></label></div>

      {error && <p role="alert" className="notice error">{error}</p>}
      <footer className="form-actions">
        <span>勘误不修改数据，由站长核对</span>
        <button type="submit" className="primary" disabled={busy || !online}>{busy ? '正在提交…' : '提交勘误 →'}</button>
      </footer>
    </form>}
  </Modal>;
}
