'use client';
import {useEffect} from 'react';
import {useSearchParams} from 'next/navigation';
export function WorkspaceInteractions(){const params=useSearchParams();useEffect(()=>{
 const open=()=>{if(!location.hash)return;let id='';try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}const el=document.getElementById(id);if(!el)return; if(el instanceof HTMLDetailsElement)el.open=true; if(id==='appeal-form'){const disclosure=el.querySelector('details');if(disclosure)disclosure.open=true;}for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;el.scrollIntoView({block:'start',behavior:'instant'});};
 open();window.addEventListener('hashchange',open);return()=>window.removeEventListener('hashchange',open);
},[params]);return null;}

