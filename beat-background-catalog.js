import { BEAT_BACKGROUND_NAMES } from './beat-backgrounds.js?v=20261007-background-catalog-v2';

export const BEAT_BACKGROUND_EVENT_CATEGORIES = Object.freeze([
    'lesson',
    'training',
    'outing',
    'communication',
    'bond',
]);

export const BEAT_BACKGROUND_CATEGORY_LABELS = Object.freeze({
    lesson: '上课',
    training: '训练',
    outing: '外出',
    communication: '交流',
    bond: '好感度剧情',
});

export const BEAT_BACKGROUND_TIME_ORDER = Object.freeze(['morning', 'noon', 'evening', 'night']);

export const BEAT_BACKGROUND_FAMILIES_BY_CATEGORY = Object.freeze({
    "communication": [
        "env_2d_adv_school-entrance-00",
        "env_2d_adv_school-entrance-01",
        "env_2d_adv_school-courtyard-bench-00",
        "env_2d_adv_school-cafeteria-00",
        "env_2d_adv_school-library-00",
        "env_2d_adv_school-councilroom-00",
        "env_2d_adv_school-nurseoffice-00",
        "env_2d_adv_school-store-00",
        "env_2d_adv_school-tearoom-00",
        "env_2d_adv_school-busstop-01",
        "env_2d_adv_school-busstop-02",
        "env_2d_adv_school-teachersroom-00",
        "env_2d_adv_school-principal-00",
        "env_2d_adv_dormitory-gate-00",
        "env_2d_adv_dormitory-gate-01",
        "env_2d_adv_dormitory-corridor-00",
        "env_2d_adv_dormitory-common-space-00",
        "env_2d_adv_dormitory-laundry-00",
        "env_2d_adv_dormitory-rooftop-00"
    ],
    "outing": [
        "env_2d_adv_outschool-townstreet-00",
        "env_2d_adv_outschool-townstreet-01",
        "env_2d_adv_outschool-arcade-street-00",
        "env_2d_adv_outschool-arcade-street-01",
        "env_2d_adv_outschool-residential-area-00",
        "env_2d_adv_other-city-00",
        "env_2d_adv_other-city-park-00",
        "env_2d_adv_other-city-library-00",
        "env_2d_adv_outschool-mall-entrance-00",
        "env_2d_adv_outschool-mall-passage-00",
        "env_2d_adv_outschool-mall-passage-01",
        "env_2d_adv_outschool-mall-cinema-00",
        "env_2d_adv_outschool-mall-cinema-01",
        "env_2d_adv_other-fashion-city-00",
        "env_2d_adv_other-discount-store-00",
        "env_2d_adv_other-convenience-store-00",
        "env_2d_adv_other-supermarket-in-00",
        "env_2d_adv_other-animate-in-00",
        "env_2d_adv_other-animate-out-00",
        "env_2d_adv_other-anime-goods-shop-00",
        "env_2d_adv_outschool-cafe-00",
        "env_2d_adv_outschool-cafe-seat-00",
        "env_2d_adv_other-coffee-shop-00",
        "env_2d_adv_outschool-cakeshop-in-00",
        "env_2d_adv_outschool-cakeshop-kitchen-00",
        "env_2d_adv_outschool-stella-burger-00",
        "env_2d_adv_outschool-maidcafe-00",
        "env_2d_adv_outschool-maidcafe-seat-00",
        "env_2d_adv_other-ramen-shop-00",
        "env_2d_adv_other-restaurant-00",
        "env_2d_adv_other-conveyor-belt-sushi-restaurant-00",
        "env_2d_adv_other-traditional-japanese-restaurant-00",
        "env_2d_adv_other-public-dining-hall-00",
        "env_2d_adv_outschool-gamecenter-out-00",
        "env_2d_adv_outschool-gamecenter-in-00",
        "env_2d_adv_outschool-karaoke-out-00",
        "env_2d_adv_outschool-karaoke-in-00",
        "env_2d_adv_outschool-aquarium-00",
        "env_2d_adv_outschool-park-00",
        "env_2d_adv_outschool-forest-00",
        "env_2d_adv_outschool-forest-01",
        "env_2d_adv_outschool-forest-river-00",
        "env_2d_adv_other-shrine-00",
        "env_2d_adv_other-shrine-01",
        "env_2d_adv_other-temple-inside-00",
        "env_2d_adv_other-sunflower-field-00",
        "env_2d_adv_other-skaterink-00",
        "env_2d_adv_other-skiresort-00",
        "env_2d_adv_other-observation-deck-00",
        "env_2d_adv_outschool-spa-resort-00",
        "env_2d_adv_outschool-summer-festival-00",
        "env_2d_adv_other-livehouse-00",
        "env_2d_adv_other-livehouse-01",
        "env_2d_adv_other-summerstage-00",
        "env_2d_adv_outschool-themepark-gate-00",
        "env_2d_adv_outschool-themepark-gate-01",
        "env_2d_adv_outschool-themepark-in-00",
        "env_2d_adv_outschool-themepark-in-01",
        "env_2d_adv_outschool-themepark-picnicarea-00",
        "env_2d_adv_outschool-themepark-picnicarea-01",
        "env_2d_adv_outschool-themepark-outstage-00",
        "env_2d_adv_outschool-themepark-outstage-01",
        "env_2d_adv_outschool-themepark-outstage-02",
        "env_2d_adv_outschool-themepark-outstage-03",
        "env_2d_adv_other-beachhouse-00",
        "env_2d_adv_other-sea-00",
        "env_2d_adv_other-tropical-sea-00",
        "env_2d_adv_other-tourist-spot-seaside-00",
        "env_2d_adv_other-kyoto-street-00",
        "env_2d_adv_other-kyoto-souvenirshop-00",
        "env_2d_adv_other-osaka-street-00",
        "env_2d_adv_other-hiroshima-city-00",
        "env_2d_adv_outschool-station-00",
        "env_2d_adv_outschool-train-00",
        "env_2d_adv_outschool-sports-facilities-00",
        "env_2d_adv_outschool-sports-facilities-batting-coat-00",
        "env_2d_adv_outschool-sports-facilities-futsal-coat-00",
        "env_2d_adv_outschool-sports-facilities-food-coat-00"
    ],
    "lesson": [
        "env_2d_adv_school-classroom-00",
        "env_2d_adv_school-pclassroom-00"
    ],
    "training": [
        "env_2d_adv_school-ground-00",
        "env_2d_adv_school-ground-01",
        "env_2d_adv_school-pool-00",
        "env_2d_adv_school-sportshall-00",
        "env_2d_adv_school-recordingstudio-00"
    ],
    "bond": []
});

// Semantic rules for Beat 3D selection. Actual scene variants are indexed in
// beat-scene-assets.js; they are never passed to the PNG loader.
export const BEAT_3D_SCENE_RULES = Object.freeze([
    {
        "family": "env_3d_adv_audition-00-00",
        "eventCategory": "fixed",
        "usage": "试镜、选拔现场",
        "preferred2dFamily": "",
        "restriction": "只由试镜/固定剧情点名；2D audition-nia 是会场外，不能替代试镜室。",
        "references": 34,
        "exampleScripts": [
            "adv_csprt-3-0097_01.txt",
            "adv_dear_atbm_019.txt"
        ]
    },
    {
        "family": "env_3d_adv_classroom-00-00",
        "eventCategory": "lesson",
        "usage": "小课室、制作人与偶像讨论课程或计划",
        "preferred2dFamily": "env_2d_adv_school-pclassroom-00",
        "restriction": "日常课室对话优先 2D；其用途与班级大教室区分。",
        "references": 627,
        "exampleScripts": [
            "adv_cidol-hmsz-3-020_01.txt",
            "adv_cidol-hski-3-006_03.txt"
        ]
    },
    {
        "family": "env_3d_adv_classroom-00-01",
        "eventCategory": "fixed",
        "usage": "课室布置变体、节日课程剧情",
        "preferred2dFamily": "env_2d_adv_school-pclassroom-00",
        "restriction": "普通课室可用 2D；需要该版本的节日装饰时由剧情指导指定 3D。",
        "references": 101,
        "exampleScripts": [
            "adv_dear_hmsz_029.txt",
            "adv_dear_ttmr_032.txt"
        ]
    },
    {
        "family": "env_3d_adv_corridor-00-00",
        "eventCategory": "communication",
        "usage": "校内通道，课前课后偶遇、往返教室",
        "preferred2dFamily": "",
        "restriction": "不能自动替换成宿舍走廊；是不同建筑地点。",
        "references": 193,
        "exampleScripts": [
            "adv_csprt-1-0005_02.txt",
            "adv_csprt-3-0073_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_councilroom-00-00",
        "eventCategory": "communication",
        "usage": "学生会室、会务、校务讨论",
        "preferred2dFamily": "env_2d_adv_school-councilroom-00",
        "restriction": "同地点普通交流优先 2D。",
        "references": 127,
        "exampleScripts": [
            "adv_cidol-amao-3-018_02.txt",
            "adv_cidol-hmsz-3-010_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_councilroom-00-01",
        "eventCategory": "fixed",
        "usage": "学生会室的节日/装饰变体",
        "preferred2dFamily": "env_2d_adv_school-councilroom-00",
        "restriction": "普通会务使用 2D；特殊装饰必须由剧情点名，不能随机用于日常。",
        "references": 11,
        "exampleScripts": [
            "adv_cidol-jsna-3-017_01.txt",
            "adv_dear_hrnm_029.txt"
        ]
    },
    {
        "family": "env_3d_adv_courtyard-00-00",
        "eventCategory": "communication",
        "usage": "校园中庭，集合、课后交流",
        "preferred2dFamily": "env_2d_adv_school-courtyard-bench-00",
        "restriction": "长椅附近交流优先 2D；全中庭构图或其他位置不能承诺由长椅局部图还原。",
        "references": 16,
        "exampleScripts": [
            "adv_cidol-hmsz-3-000_01.txt",
            "adv_cidol-kcna-3-001_03.txt"
        ]
    },
    {
        "family": "env_3d_adv_courtyard-00-01",
        "eventCategory": "fixed",
        "usage": "中庭活动布置或特殊课程后的交流",
        "preferred2dFamily": "",
        "restriction": "固定活动布置；普通中庭优先现有 2D 长椅地点。",
        "references": 14,
        "exampleScripts": [
            "adv_dear_fktn_032.txt",
            "adv_dear_ttmr_032.txt"
        ]
    },
    {
        "family": "env_3d_adv_danceroom-00-00",
        "eventCategory": "training",
        "usage": "学校舞蹈练习、排练和练习间隙对话",
        "preferred2dFamily": "",
        "restriction": "无同地点 2D；其他事务所/别校舞蹈室不可当作初星学园。",
        "references": 288,
        "exampleScripts": [
            "adv_cidol-ssmk-3-007_02.txt",
            "adv_csprt-2-0053_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_danceroom-00-01",
        "eventCategory": "fixed",
        "usage": "舞蹈室的特殊布置",
        "preferred2dFamily": "",
        "restriction": "有装饰变体；常规舞蹈训练优先 00-00，特殊剧情才点名。",
        "references": 21,
        "exampleScripts": [
            "adv_cidol-jsna-3-017_03.txt",
            "adv_dear_fktn_032.txt"
        ]
    },
    {
        "family": "env_3d_adv_dormitory-00-00",
        "eventCategory": "fixed",
        "usage": "组合剧情使用的宿舍内景",
        "preferred2dFamily": "",
        "restriction": "具体房间身份尚未确认；不能仅凭 dormitory 自动当作所有人的房间或公共休息室。",
        "references": 6,
        "exampleScripts": [
            "adv_unit_01-02_07.txt",
            "adv_unit_01-02_09.txt"
        ]
    },
    {
        "family": "env_3d_adv_dormterrace-00-00",
        "eventCategory": "communication",
        "usage": "宿舍入口附近、门前庭院的交流",
        "preferred2dFamily": "env_2d_adv_dormitory-gate-00",
        "restriction": "同地点优先 2D 宿舍门口；不是宿舍天台。",
        "references": 22,
        "exampleScripts": [
            "adv_cidol-amao-3-001_03.txt",
            "adv_cidol-amao-3-002_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_hallexterior-00-00",
        "eventCategory": "fixed",
        "usage": "礼堂/演出建筑外围，到场和散场",
        "preferred2dFamily": "",
        "restriction": "学校入口大厅是室内，NIA 试镜会场外是另一地点，不能自动互换。",
        "references": 19,
        "exampleScripts": [
            "adv_cidol-ttmr-3-009_02.txt",
            "adv_dear_atbm_009.txt"
        ]
    },
    {
        "family": "env_3d_adv_hallexterior-00-01",
        "eventCategory": "fixed",
        "usage": "礼堂外围的活动布置变体",
        "preferred2dFamily": "",
        "restriction": "活动背景，不加入普通校内交流短名单。",
        "references": 24,
        "exampleScripts": [
            "adv_cidol-hski-3-018_01.txt",
            "adv_dear_atbm_026.txt"
        ]
    },
    {
        "family": "env_3d_adv_hallway-00-00",
        "eventCategory": "communication",
        "usage": "室内过道的短对话、往返和偶遇",
        "preferred2dFamily": "",
        "restriction": "具体建筑需由剧情确定；不得把所有室内走廊都解释成宿舍。01-00 已统一到此代表。",
        "references": 23,
        "exampleScripts": [
            "adv_cidol-hume-3-006_03.txt",
            "adv_dear_amao_027.txt"
        ]
    },
    {
        "family": "env_3d_adv_hotspring-00-00",
        "eventCategory": "outing",
        "usage": "温泉浴池/泡汤活动",
        "preferred2dFamily": "",
        "restriction": "2D spa-resort 是休息区，不是浴池；只有剧情在休息区时才选该 2D。",
        "references": 35,
        "exampleScripts": [
            "adv_event_006_main-01.txt",
            "adv_pevent_002_hmsz_sales_3-005-02.txt"
        ]
    },
    {
        "family": "env_3d_adv_offstage-00-00",
        "eventCategory": "fixed",
        "usage": "舞台后台、登台前和演出后",
        "preferred2dFamily": "",
        "restriction": "2D hall-outstage 是户外舞台搭建现场，不是后台；不要自动替代。",
        "references": 99,
        "exampleScripts": [
            "adv_cidol-hrnm-3-000_03.txt",
            "adv_cidol-shro-3-000_03.txt"
        ]
    },
    {
        "family": "env_3d_adv_riverbed-00-00",
        "eventCategory": "outing",
        "usage": "河岸散步、户外交流或营业活动",
        "preferred2dFamily": "env_2d_adv_other-river-00",
        "restriction": "普通河岸活动优先 2D；若种子要求具体城市河堤或该 3D 布景，应由种子点名。",
        "references": 46,
        "exampleScripts": [
            "adv_csprt-2-0028_01.txt",
            "adv_csprt-2-0028_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_rooftop-00-00",
        "eventCategory": "communication",
        "usage": "学校屋顶上的私下谈话或休息",
        "preferred2dFamily": "",
        "restriction": "2D dormitory-rooftop 是宿舍天台，与学校屋顶是不同地点。",
        "references": 48,
        "exampleScripts": [
            "adv_cidol-hski-3-011_03.txt",
            "adv_cidol-kllj-3-022_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_schoolgarden-00-00",
        "eventCategory": "communication",
        "usage": "校园绿地、花园内的课后交流",
        "preferred2dFamily": "",
        "restriction": "中庭长椅仅适合长椅地点；不能把完整校园绿地当作同一张局部背景。",
        "references": 105,
        "exampleScripts": [
            "adv_cidol-hski-3-011_01.txt",
            "adv_dear_hrnm_022.txt"
        ]
    },
    {
        "family": "env_3d_adv_schoolgarden-00-03",
        "eventCategory": "fixed",
        "usage": "校园绿地的活动搭建/特殊课程布置",
        "preferred2dFamily": "",
        "restriction": "有活动设施，与普通绿地不同；不因为字段名出现 star 就自动选用。",
        "references": 13,
        "exampleScripts": [
            "adv_csprt-3-0099_01.txt",
            "adv_pstep_003_cmmn_before-lesson-star-01-b.txt"
        ]
    },
    {
        "family": "env_3d_adv_schoolroom-00-00",
        "eventCategory": "lesson",
        "usage": "学生班级教室，上课、课前课后交流",
        "preferred2dFamily": "env_2d_adv_school-classroom-00",
        "restriction": "同地点普通剧情优先 2D；与小课室区分。",
        "references": 303,
        "exampleScripts": [
            "adv_cidol-fktn-3-016_01.txt",
            "adv_event_028_main-03.txt"
        ]
    },
    {
        "family": "env_3d_adv_seats-00-00",
        "eventCategory": "fixed",
        "usage": "演出会场观众席、观看演出",
        "preferred2dFamily": "",
        "restriction": "学校操场观众席属于体育活动，不能替代演出会场观众席。",
        "references": 25,
        "exampleScripts": [
            "adv_cidol-jsna-3-017_02.txt",
            "adv_csprt-2-0079_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_sharedspace-00-00",
        "eventCategory": "communication",
        "usage": "公共共享空间，多人集合和闲聊",
        "preferred2dFamily": "",
        "restriction": "与 dormitory-common-space 是否同一地点需确认；普通宿舍休息室直接用 2D，不自动等同两者。",
        "references": 138,
        "exampleScripts": [
            "adv_cidol-hski-3-012_02.txt",
            "adv_csprt-2-0069_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_toschool-00-00",
        "eventCategory": "communication",
        "usage": "通学路线、放学返程、路上偶遇",
        "preferred2dFamily": "",
        "restriction": "城市商业街不是已确认的同一路段；剧情地点为商业街时才改用 2D townstreet。",
        "references": 71,
        "exampleScripts": [
            "adv_cidol-atbm-3-018_02.txt",
            "adv_cidol-ttmr-3-021_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_toschool-00-02",
        "eventCategory": "fixed",
        "usage": "通学路线的节日/装饰版本",
        "preferred2dFamily": "",
        "restriction": "需要特殊布置时固定指定；常规通学不随机选这个版本。",
        "references": 14,
        "exampleScripts": [
            "adv_csprt-3-0104_02.txt",
            "adv_dear_amao_028.txt"
        ]
    },
    {
        "family": "env_3d_adv_toschoolop-00-00",
        "eventCategory": "fixed",
        "usage": "到校开场、首次进入学校的构图",
        "preferred2dFamily": "",
        "restriction": "仅开场或固定剧情；不会因为一次普通外出就重新生成入学开场。",
        "references": 8,
        "exampleScripts": [
            "adv_csprt-2-0013_02.txt",
            "adv_csprt-3-0005_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_trainingroom-00-00",
        "eventCategory": "training",
        "usage": "综合训练室、体能练习和练习后交流",
        "preferred2dFamily": "",
        "restriction": "2D hanami-training-center 属于另一训练中心，不仅因为名字类似就替代。",
        "references": 8,
        "exampleScripts": [
            "adv_csprt-2-0073_01.txt",
            "adv_csprt-3-0078_01.txt"
        ]
    },
    {
        "family": "env_3d_adv_trainingroom-00-01",
        "eventCategory": "fixed",
        "usage": "咲季/佑芽同场的训练室剧情变体",
        "preferred2dFamily": "",
        "restriction": "已确认脚本 adv_csprt-3-0023_02；日常训练优先 00-00，种子才点名 00-01。",
        "references": 1,
        "exampleScripts": [
            "adv_csprt-3-0023_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_visualroom-00-00",
        "eventCategory": "training",
        "usage": "学校视觉训练、表现练习和拍摄",
        "preferred2dFamily": "",
        "restriction": "当前无同地点 2D；不是录音控制室。另两视觉室候选已统一到本代表。",
        "references": 32,
        "exampleScripts": [
            "adv_csprt-2-0008_02.txt",
            "adv_csprt-2-0036_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_vocalroom-00-00",
        "eventCategory": "training",
        "usage": "学校声乐练习、发声训练",
        "preferred2dFamily": "",
        "restriction": "2D recordingstudio 是录音控制室；练声现场与控制室必须区分。",
        "references": 80,
        "exampleScripts": [
            "adv_cidol-jsna-3-016_03.txt",
            "adv_csprt-3-0057_02.txt"
        ]
    },
    {
        "family": "env_3d_adv_vocalroom-00-01",
        "eventCategory": "fixed",
        "usage": "声乐室的特殊布置或固定个人剧情",
        "preferred2dFamily": "",
        "restriction": "日常声乐训练优先 00-00；这个版本由剧情指导点名。",
        "references": 19,
        "exampleScripts": [
            "adv_dear_hski_029.txt",
            "adv_dear_hski_031.txt"
        ]
    },
    {
        "family": "env_3d_adv_waitingroom-00-00",
        "eventCategory": "fixed",
        "usage": "试镜/演出候场、准备和结果等待",
        "preferred2dFamily": "",
        "restriction": "NIA 候场用 2D other-waitingroom-nia-00；普通学校候场室与 NIA 会场不自动等同。",
        "references": 279,
        "exampleScripts": [
            "adv_dear_hmsz_030.txt",
            "adv_dear_jsna_009.txt"
        ]
    },
    {
        "family": "env_3d_lesson_danceroom-00-00",
        "eventCategory": "lesson",
        "usage": "课程系统的普通舞蹈课",
        "preferred2dFamily": "",
        "restriction": "上课类别按课程具体学科细分，别把舞蹈课送进普通班级教室。",
        "references": 17,
        "exampleScripts": [
            "adv_event_011_main-02.txt",
            "adv_pstep_001_cmmn_before-lesson-02-d.txt"
        ]
    },
    {
        "family": "env_3d_lesson_danceroom-00-01",
        "eventCategory": "lesson",
        "usage": "舞蹈、拉伸等课程的另一布置",
        "preferred2dFamily": "",
        "restriction": "只在课程确实需要该布置时使用；00/01 不是昼夜版本。",
        "references": 23,
        "exampleScripts": [
            "adv_produce_lesson_param-da-step-unit1-001.txt",
            "adv_produce_lesson_sp-param-da-dance-a-001.txt"
        ]
    },
    {
        "family": "env_3d_lesson_vocalroom-00-00",
        "eventCategory": "lesson",
        "usage": "声乐课、课前声乐准备",
        "preferred2dFamily": "",
        "restriction": "无同地点 2D；上课类型为声乐时使用，不当作普通文化课。",
        "references": 16,
        "exampleScripts": [
            "adv_pstep_001_cmmn_before-lesson-01-b.txt",
            "adv_pstep_001_cmmn_before-lesson-04-a.txt"
        ]
    }
]);

const TIME_PATTERN = /-(morning|noon|evening|night|other)$/iu;
const PNG_PATTERN = /\.png$/iu;

function cleanToken(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/gu, '').replace(PNG_PATTERN, '');
}

function fullFamily(value) {
    const token = cleanToken(value);
    return token.startsWith('env_2d_') ? token : `env_2d_adv_${token}`;
}

function familyAliases(family) {
    const aliases = new Set([family]);
    if (family.startsWith('env_2d_adv_')) aliases.add(family.slice('env_2d_adv_'.length));
    if (family.startsWith('env_2d_other_')) aliases.add(family.slice('env_2d_other_'.length));
    return aliases;
}

export function backgroundFamily(value) {
    const token = cleanToken(value);
    return token.replace(TIME_PATTERN, '');
}

export function backgroundTime(value) {
    return cleanToken(value).match(TIME_PATTERN)?.[1]?.toLowerCase() || '';
}

function categoryFamilies(category, names) {
    const key = String(category || '').trim().toLowerCase();
    const allowed = new Set(BEAT_BACKGROUND_FAMILIES_BY_CATEGORY[key] || []);
    return new Set((Array.isArray(names) ? names : BEAT_BACKGROUND_NAMES)
        .map(backgroundFamily).filter(family => allowed.has(family)));
}

export function beatBackgroundFamilies(category, names = BEAT_BACKGROUND_NAMES) {
    return [...categoryFamilies(category, names)].sort();
}

export function beatBackgroundEventTag(category) {
    const key = BEAT_BACKGROUND_EVENT_CATEGORIES.includes(String(category || '').trim().toLowerCase())
        ? String(category || '').trim().toLowerCase()
        : 'communication';
    return `BEAT_BACKGROUND_EVENT=${key}`;
}

function libraryFilename(value) {
    const base = String(value || '').trim().replace(/^['"]|['"]$/gu, '').split(/[\\/]/u).pop()?.split('?')[0]?.trim() || '';
    if (!base || base === '.' || base === '..') return '';
    if (!/\.png$/iu.test(base) && !/^env_2d_/iu.test(base)) return '';
    return `${base.replace(/\.png$/iu, '')}.png`;
}

function libraryFilenameHit(value, source) {
    const filename = libraryFilename(value);
    if (!filename) return '';
    const stem = filename.replace(/\.png$/iu, '');
    const wanted = new Set([filename.toLowerCase()]);
    if (/^env_2d_/iu.test(stem) && !/^env_2d_(?:adv|other)_/iu.test(stem)) {
        const rest = stem.replace(/^env_2d_/iu, '');
        wanted.add(`env_2d_adv_${rest}.png`.toLowerCase());
        wanted.add(`env_2d_other_${rest}.png`.toLowerCase());
    }
    const hits = source.filter(name => wanted.has(String(name).trim().toLowerCase()));
    if (hits.length === 1) return hits[0];
    const exact = hits.find(name => String(name).trim().toLowerCase() === filename.toLowerCase());
    if (exact) return exact;
    const adv = hits.find(name => String(name).trim().toLowerCase().startsWith('env_2d_adv_'));
    if (adv) return adv;
    const suffix = filename.toLowerCase();
    const suffixHits = source.filter(name => String(name).trim().toLowerCase().endsWith(suffix));
    return suffixHits.length === 1 ? suffixHits[0] : '';
}

function chooseTime(candidates, requestedTime) {
    if (!candidates.length) return '';
    if (requestedTime === 'other') return candidates.find(item => item.time === 'other')?.name || '';
    const timeless = candidates.find(item => !item.time);
    if (timeless) return timeless.name;
    const requestedIndex = Math.max(0, BEAT_BACKGROUND_TIME_ORDER.indexOf(requestedTime || 'noon'));
    const ranked = candidates
        .filter(item => item.time !== 'other')
        .sort((a, b) => BEAT_BACKGROUND_TIME_ORDER.indexOf(a.time) - BEAT_BACKGROUND_TIME_ORDER.indexOf(b.time));
    if (!ranked.length) return '';
    const earlier = ranked.filter(item => BEAT_BACKGROUND_TIME_ORDER.indexOf(item.time) <= requestedIndex);
    return (earlier.at(-1) || ranked[0]).name;
}

/** Resolve a short worldbook location token or a full PNG name to a real 2D asset. */
export function resolveBeatBackground(value, { backgrounds = BEAT_BACKGROUND_NAMES, category = '' } = {}) {
    const source = [...new Set((Array.isArray(backgrounds) ? backgrounds : [...backgrounds]).map(item => String(item || '').trim()).filter(Boolean))];
    const input = cleanToken(value);
    if (!input) return { name: '', family: '', time: '', matched: false };
    const requestedTime = backgroundTime(input);
    const requestedFamilyToken = backgroundFamily(input);
    const candidateFamilies = categoryFamilies(category, source);
    const candidates = source
        .map(name => ({ name, family: backgroundFamily(name), time: backgroundTime(name) }))
        .filter(item => familyAliases(item.family).has(requestedFamilyToken) || item.family === fullFamily(requestedFamilyToken));
    if (!candidates.length) {
        const named = libraryFilenameHit(value, source);
        if (!named) return { name: '', family: requestedFamilyToken, time: requestedTime, matched: false };
        const namedFamily = backgroundFamily(named);
        if (category && category !== 'bond' && !candidateFamilies.has(namedFamily)) {
            return { name: '', family: namedFamily, time: backgroundTime(named), matched: false, categoryMismatch: true };
        }
        return { name: named, family: namedFamily, time: backgroundTime(named), matched: true, exact: true };
    }
    if (category && category !== 'bond' && !candidates.some(item => candidateFamilies.has(item.family))) {
        return { name: '', family: requestedFamilyToken, time: requestedTime, matched: false, categoryMismatch: true };
    }
    const exact = candidates.find(item => cleanToken(item.name) === input);
    const name = exact?.name || chooseTime(candidates, requestedTime);
    return { name, family: backgroundFamily(name), time: backgroundTime(name), matched: Boolean(name), exact: false };
}
