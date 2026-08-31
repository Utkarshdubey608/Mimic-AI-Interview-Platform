"""Default starter code, per language.

A recruiter authoring one problem should not have to hand-write nine skeletons,
and a candidate should not spend the first two minutes of a timed assessment
remembering how to read stdin in C#.

WHAT A STARTER IS FOR, and it is not politeness. These problems are stdin/stdout:
the judge writes the test case to standard input and compares standard output.
That is the part every candidate gets wrong first, in every language, and it is
not what is being assessed. So each starter does exactly one thing — reads all of
stdin and leaves a marked place to solve the problem — and nothing else. No
algorithm, no hints, no half-written solution to reverse-engineer.

They are DEFAULTS, not fixtures: a problem's own `starterCode` overrides these
per language, because a problem about a tree wants a tree already parsed.

Verified against the judge, not written from memory: each of these compiles and
runs on the deployed Judge0, echoing its input. A starter that does not compile is
worse than no starter at all — the candidate's first Run fails and they have no
way to tell whether the fault is theirs.
"""

from __future__ import annotations

# Keyed by the canonical language keys in coding_languages.CANONICAL.
STARTERS: dict[str, str] = {
    "python": '''import sys

def solve(data: list[str]) -> None:
    # data is every whitespace-separated token from stdin.
    # Your solution goes here. Print the answer with print().
    pass

solve(sys.stdin.read().split())
''',
    "javascript": '''const data = require('fs').readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);

function solve(data) {
  // Your solution goes here. Print the answer with console.log().
}

solve(data);
''',
    # `require` needs declaring. The judge compiles with tsc and no @types/node, so
    # a bare require() is TS2304 before the candidate's code runs at all. Found by
    # judge0-verify.sh against the live judge, not by review.
    "typescript": '''declare const require: (name: string) => any;

const data: string[] = require('fs')
  .readFileSync(0, 'utf8')
  .split(/\\s+/)
  .filter(Boolean);

function solve(data: string[]): void {
  // Your solution goes here. Print the answer with console.log().
}

solve(data);
''',
    "java": '''import java.io.*;
import java.util.*;

public class Main {
    static void solve(String[] data) {
        // Your solution goes here. Print the answer with System.out.println().
    }

    public static void main(String[] args) throws IOException {
        StringBuilder sb = new StringBuilder();
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = br.readLine()) != null) sb.append(line).append(' ');
        String[] data = sb.toString().trim().isEmpty()
            ? new String[0]
            : sb.toString().trim().split("\\\\s+");
        solve(data);
    }
}
''',
    "cpp": '''#include <bits/stdc++.h>
using namespace std;

void solve(vector<string>& data) {
    // Your solution goes here. Print the answer with cout.
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    vector<string> data;
    for (string token; cin >> token; ) data.push_back(token);
    solve(data);
    return 0;
}
''',
    "c": '''#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    /* Read whitespace-separated tokens from stdin with scanf, then print the
       answer with printf. */
    char token[256];
    while (scanf("%255s", token) == 1) {
        /* Your solution goes here. */
    }
    return 0;
}
''',
    "csharp": '''using System;
using System.Collections.Generic;

class Program {
    static void Solve(List<string> data) {
        // Your solution goes here. Print the answer with Console.WriteLine().
    }

    static void Main() {
        var data = new List<string>();
        string line;
        while ((line = Console.ReadLine()) != null) {
            data.AddRange(line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
        }
        Solve(data);
    }
}
''',
    "go": '''package main

import (
	"bufio"
	"fmt"
	"os"
)

func solve(data []string) {
	// Your solution goes here. Print the answer with fmt.Println().
	_ = data
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	sc.Split(bufio.ScanWords)
	var data []string
	for sc.Scan() {
		data = append(data, sc.Text())
	}
	solve(data)
	_ = fmt.Sprint
}
''',
    "rust": '''use std::io::{self, Read};

fn solve(data: &[String]) {
    // Your solution goes here. Print the answer with println!().
    let _ = data;
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let data: Vec<String> = input.split_whitespace().map(String::from).collect();
    solve(&data);
}
''',
}


def starter_for(language_key: str) -> str:
    """The default skeleton for a language, or empty if we have none.

    Empty rather than a generic comment: an editor that opens blank is honest,
    and one that opens with a skeleton for the wrong language is worse than one
    that opens with nothing.
    """
    return STARTERS.get(language_key, "")


def with_starters(languages: list[dict]) -> list[dict]:
    """Attach the default starter to each resolved language."""
    return [{**entry, "starter": starter_for(str(entry.get("key")))} for entry in languages]
