/* ------------------------------------------------------------------ */
/* scheduler.rs：DAG 拓扑（Kahn 分层）—— 依赖先启、同层并发、级联启停      */
/* 纯函数，无 IO，可独立单测                                              */
/* ------------------------------------------------------------------ */

use std::collections::{HashMap, HashSet};

use crate::infra::config::TaskConfig;

/// 任务名 → 直接依赖集合（仅统计已存在的依赖，未知依赖忽略并告警）
pub fn direct_deps(tasks: &[TaskConfig]) -> HashMap<String, Vec<String>> {
    let names: HashSet<&str> = tasks.iter().map(|t| t.name.as_str()).collect();
    let mut map = HashMap::new();
    for t in tasks {
        let deps: Vec<String> = t
            .deps
            .iter()
            .filter(|d| names.contains(d.as_str()) && *d != &t.name)
            .cloned()
            .collect();
        map.insert(t.name.clone(), deps);
    }
    map
}

/// 任务名 → 下游（依赖它的任务）
pub fn dependents(tasks: &[TaskConfig]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for t in tasks {
        map.entry(t.name.clone()).or_default();
    }
    for t in tasks {
        for d in &t.deps {
            if let Some(list) = map.get_mut(d) {
                if !list.contains(&t.name) {
                    list.push(t.name.clone());
                }
            }
        }
    }
    map
}

/// Kahn 拓扑分层：每层内无依赖关系（可并发启动）。返回层列表（每层为任务名）。
pub fn topo_levels(tasks: &[TaskConfig]) -> Vec<Vec<String>> {
    let deps = direct_deps(tasks);
    let mut indeg: HashMap<String, usize> = deps.iter().map(|(k, v)| (k.clone(), v.len())).collect();
    let depend = dependents(tasks);

    let mut levels: Vec<Vec<String>> = Vec::new();
    let mut frontier: Vec<String> = indeg
        .iter()
        .filter(|(_, d)| **d == 0)
        .map(|(k, _)| k.clone())
        .collect();
    while !frontier.is_empty() {
        levels.push(frontier.clone());
        let mut next: Vec<String> = Vec::new();
        for node in &frontier {
            if let Some(children) = depend.get(node) {
                for c in children {
                    if let Some(d) = indeg.get_mut(c) {
                        *d -= 1;
                        if *d == 0 {
                            next.push(c.clone());
                        }
                    }
                }
            }
        }
        frontier = next;
    }
    // 存在环或未知依赖导致未排入的任务，追加为最后一层
    let scheduled: HashSet<String> = levels.iter().flatten().cloned().collect();
    let leftovers: Vec<String> = indeg.keys().filter(|k| !scheduled.contains(*k)).cloned().collect();
    if !leftovers.is_empty() {
        levels.push(leftovers);
    }
    levels
}

/// 反拓扑序（停止用）：先停最下游
pub fn reverse_topo(tasks: &[TaskConfig]) -> Vec<Vec<String>> {
    let mut levels = topo_levels(tasks);
    levels.reverse();
    levels
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::config::{Health, Kind, Strategy, TaskConfig};

    fn task(name: &str, deps: &[&str]) -> TaskConfig {
        TaskConfig {
            name: name.into(),
            kind: Kind::Exe,
            path: "x.exe".into(),
            args: vec![],
            cwd: String::new(),
            strategy: Strategy::OnFailure,
            graceful_timeout: 0,
            deps: deps.iter().map(|s| s.to_string()).collect(),
            health: Health::default(),
            enabled: true,
        }
    }

    #[test]
    fn kahn_orders_dependencies() {
        let tasks = vec![
            task("a", &[]),
            task("b", &["a"]),
            task("c", &["a"]),
            task("d", &["b", "c"]),
        ];
        let levels = topo_levels(&tasks);
        assert_eq!(levels[0], vec!["a"]);
        assert!(levels[1].contains(&"b".to_string()) && levels[1].contains(&"c".to_string()));
        assert_eq!(levels[2], vec!["d"]);
    }

    #[test]
    fn reverse_stops_leaves_first() {
        let tasks = vec![task("a", &[]), task("b", &["a"])];
        let rev = reverse_topo(&tasks);
        assert_eq!(rev[0], vec!["b"]);
        assert_eq!(rev[1], vec!["a"]);
    }

    #[test]
    fn cycle_does_not_hang() {
        let tasks = vec![task("a", &["b"]), task("b", &["a"])];
        let levels = topo_levels(&tasks);
        assert_eq!(levels.len(), 1);
        assert_eq!(levels[0].len(), 2);
    }
}
