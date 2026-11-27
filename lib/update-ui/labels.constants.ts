/** Every text the components show. Turkish by default; pass `labels` to change any of them. */
type UpdateLabels = {
  /** The button that asks for a check (shown with `isAlwaysVisible`). */
  check: string;
  /** While the feed is being read. */
  checking: string;
  /** Nothing newer is published. */
  upToDate: string;
  /** This build cannot update itself. */
  unsupported: string;
  /** The button that starts the download. */
  update: (version: string) => string;
  /** The accessible name of the progress bar. */
  downloading: string;
  /** The button that restarts into the downloaded update. */
  restart: string;
  /** While the program is quitting to install. */
  restarting: string;
  /** The button after a failure. */
  retry: string;
  /** Read to screen readers when an update is found. */
  announceAvailable: (version: string) => string;
  /** Read to screen readers, and shown in the gate, when the download is done. */
  announceDownloaded: (version: string) => string;
  /** The gate's heading. */
  gateTitle: string;
  /** The gate's explanation. */
  gateBody: (productName: string) => string;
  /** The label of the running version. */
  installedVersion: string;
  /** The label of the version that will be installed. */
  newVersion: string;
  /** The gate's button that downloads, then restarts. */
  updateNow: string;
  /** The gate's button once the download is done. */
  restartAndUpdate: string;
  /** The gate while the feed is being read. */
  searching: string;
  /** The gate's note about the size of the download. */
  downloadSize: (size: string) => string;
  /** The gate's note that the program restarts by itself after the download. */
  willRestart: string;
  /** The gate when the feed has nothing to install yet. */
  notYetAvailable: string;
  /** The gate in a build that cannot update itself. */
  cannotSelfUpdate: string;
  /** The button that opens the download page. */
  downloadManually: string;
  /** The heading of the gate's error box. */
  errorTitle: string;
};

const DEFAULT_UPDATE_LABELS: Readonly<UpdateLabels> = {
  check: "Güncellemeleri denetle",
  checking: "Denetleniyor…",
  upToDate: "Program güncel",
  unsupported: "Bu kurulum kendini güncelleyemiyor",
  update: (version) => `Güncelle ${version}`,
  downloading: "Güncelleme indiriliyor",
  restart: "Yeniden başlat",
  restarting: "Yeniden başlatılıyor…",
  retry: "Yeniden dene",
  announceAvailable: (version) =>
    `${version} sürümü yayımlandı. Güncelleyebilirsiniz.`,
  announceDownloaded: (version) =>
    `${version} sürümü indirildi. Kurmak için programı yeniden başlatın.`,
  gateTitle: "Güncelleme gerekli",
  gateBody: (productName) =>
    `${productName} programının kurulu sürümü artık desteklenmiyor. Kullanmaya devam etmek için programı güncelleyin.`,
  installedVersion: "Kurulu sürüm",
  newVersion: "Yeni sürüm",
  updateNow: "Şimdi güncelle",
  restartAndUpdate: "Yeniden başlat ve güncelle",
  searching: "Yeni sürüm aranıyor…",
  downloadSize: (size) => `İndirme boyutu ${size}.`,
  willRestart: "İndirme bitince program kendiliğinden yeniden başlayacak.",
  notYetAvailable:
    "Yeni sürüm bu bilgisayara henüz ulaşmadı. Birkaç dakika içinde yeniden denenecek; beklemek istemezseniz yeni sürümü indirip kendiniz kurabilirsiniz.",
  cannotSelfUpdate:
    "Bu kurulum kendini güncelleyemiyor. Yeni sürümü indirip kurun; verileriniz yerinde kalır.",
  downloadManually: "Yeni sürümü indir",
  errorTitle: "Güncellenemedi",
};

export type { UpdateLabels };
export default DEFAULT_UPDATE_LABELS;
