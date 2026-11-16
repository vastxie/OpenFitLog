const {
  APP_NAME,
  PRIVACY_OPERATOR,
  PRIVACY_EMAIL,
  getThemeStyle,
} = require('../../utils/config');
const storage = require('../../utils/storage');

function buildPrivacySections() {
  const cloudEnabled = storage.isCloudConfigured();
  const sections = [
    {
      title: '1. 收集哪些数据',
      lines: cloudEnabled
        ? [
            '小程序处理你主动填写的训练记录、训练计划、自建动作、收藏动作、体重记录，以及选填的性别、年龄、身高和目标体重。',
            '开启「云同步」时，还会通过微信登录接口获取你的微信 OpenID，仅用来识别对应的云端备份。小程序不会读取手机号、位置、通讯录、相册或剪贴板。',
          ]
        : [
            '小程序仅在本机保存你主动填写的训练记录、训练计划、自建动作、收藏动作、体重记录，以及选填的性别、年龄、身高和目标体重。',
            '小程序不会读取手机号、位置、通讯录、相册或剪贴板，也不会向第三方服务器上传你的个人数据。',
          ],
    },
    {
      title: '2. 数据用来做什么',
      lines: cloudEnabled
        ? [
            '展示训练日历、动作历史和统计图表，并在定制计划时根据身体数据估算起始重量。',
            '开启云同步后，将记录备份到已配置的同步服务器，换手机或重装微信时可以找回。',
            '数据不用于广告，也不会提供给任何第三方。',
          ]
        : [
            '展示训练日历、动作历史和统计图表，并在定制计划时根据身体数据估算起始重量。',
            '数据不用于广告，也不会提供给任何第三方。',
          ],
    },
    {
      title: '3. 数据保存在哪里',
      lines: cloudEnabled
        ? [
            '未开启云同步时，数据只保存在本机微信存储中，删除小程序就会清空。',
            '开启云同步后，数据通过 HTTPS 加密传输至同步服务器保存；你可以随时导出 CSV 本地备份。',
          ]
        : [
            '全部数据仅保存在本机微信存储中，删除小程序或清理微信缓存会清空记录。建议定期通过「我的 - 导出数据」备份 CSV 文件。',
          ],
    },
    {
      title: '4. 管理与删除数据',
      lines: cloudEnabled
        ? [
            '在「我的 - 云同步」里可以随时点击「关闭同步」，或选择「关闭并删除云端数据」清空服务器上的备份。',
            '在「训练」页点进单次训练，可以从右上角菜单删除。在「体重」页点击单条记录即可删除。',
          ]
        : [
            '在「训练」页点进单次训练，可以从右上角菜单删除；在「体重」页点击单条记录即可删除；删除小程序即可清空本机全部数据。',
          ],
    },
    {
      title: '5. 运动安全提示',
      lines: [
        '小程序里的训练计划、动作要点、估算重量和休息时间仅供日常训练参考，不作为医疗诊断或康复建议。如有伤病或身体不适，请先咨询医生。',
      ],
    },
  ];

  const contactLines = [];
  if (PRIVACY_OPERATOR) contactLines.push(`运营主体：${PRIVACY_OPERATOR}`);
  if (PRIVACY_EMAIL) contactLines.push(`联系邮箱：${PRIVACY_EMAIL}`);
  contactLines.push('如有隐私相关问题，可通过「我的 - 联系客服」反馈。');

  sections.push({
    title: '6. 联系方式',
    lines: contactLines,
  });

  return sections;
}

// 修改本页内容或 utils/config.js 中的 PRIVACY_* 配置时，请同步更新小程序后台的《用户隐私保护指引》
Page({
  data: {
    themeStyle: '',
    updatedAt: '2026 年 11 月 16 日',
    intro: PRIVACY_OPERATOR
      ? `「${APP_NAME}」由${PRIVACY_OPERATOR}开发运营。`
      : `欢迎使用「${APP_NAME}」。我们非常重视你的隐私与数据控制权。`,
    sections: buildPrivacySections(),
  },

  onShow() {
    this.setData({
      themeStyle: getThemeStyle(storage.getProfile().theme),
      sections: buildPrivacySections(),
    });
  },
});
